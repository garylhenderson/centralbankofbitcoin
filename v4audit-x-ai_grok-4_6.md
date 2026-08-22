**FINDINGS**

**HIGH — SEAL/BURN `update_config` can permanently brick every vault, or silently drop the only on-chain ATA check.**  
`UpdateConfig` mutates `collection`, `bank`, `admin`, and `reserve_mints` in one admin signature. Collection is written into every AssetV1 header at mint; changing `config.collection` makes `read_core_asset` / `ForeignVault` fail for every existing vault. Same tx can also set `admin` to a dead key.

Exploit: SEAL admin submits `update_config(collection: Some(random), admin: Some(random))`. Every later `open_for_redemption` / `close_redemption` dies. cbBTC stays in the asset-signer ATAs; Execute stays frozen; nobody can rotate admin back. Same shape on BURN: set `reserve_mints` to a dummy mint → the reserve loop no longer sees cbBTC; a Bank that only eyeballs top-level ix names will co-sign `burn_vault` on a full vault and the token accounts become unsignable.

Fix: after `initialize`, freeze `collection`. Require the new `bank` to sign a rotation. Refuse any `reserve_mints` write that drops a mint already listed (or hardcode cbBTC). Split admin rotation into its own ix.

**HIGH — Three configs can disagree; nothing on-chain notices.**  
SEAL, MINT, BURN each store their own `collection` / `bank` / `reserve_mints`. MINT hardcodes `SEAL_PDA` as a raw pubkey, not `find_program_address([b"seal"], SEAL_ID)`.

If they diverge:
- MINT.collection ≠ SEAL.collection → newly minted “official” vaults are unredeemable (`ForeignVault`).
- MINT.bank ≠ SEAL.bank → the key that blessed the mint cannot redeem it.
- BURN.reserve_mints ≠ SEAL.reserve_mints → close still inspects cbBTC ATAs; burn does not. That is how finding 1 becomes a destroy-BTC path rather than a brick.
- Wrong `SEAL_PDA` → CreateV2 writes a PermanentFreezeExecute authority that the SEAL program cannot sign. Every vault is born permanently frozen. Fail-closed, still total loss.

Fix: mint/burn take the SEAL config PDA as an account and `require_keys_eq` collection/bank/reserves. Replace `SEAL_PDA` with a const program id + derived PDA, and assert it in `initialize`.

**MEDIUM — `set_round` is a supply escape hatch, not a cap.**  
`cap == 0` means unlimited. Every `set_round` does `round_id += 1` and `minted_this_round = 0` with no check that the previous window ended. `closes_at = i64::MAX` never closes. `price_lamports = 0` is a free mint. No overflow on price (no multiply). `round_id` is monotonic until `u32::MAX`, then `set_round` dies forever.

Exploit: governance calls `set_round` again whenever `minted_this_round` approaches `cap`. Bank must still sign each `mint_vault`, so this is hostile-gov + Bank, not a stranger.

Fix: if cap is a real promise, accumulate `minted_total` that `set_round` cannot clear; reject `cap == 0` and `closes_at - opens_at` above a bound.

**MEDIUM — `close_redemption` is not actually terminal-only.**  
Open correctly requires a later top-level `CloseRedemption` for the same asset *and* owner (`accounts[0]`, `accounts[2]`). Close does **not** require a preceding open. Owner+Bank can `close_redemption` a never-thawed vault; `mark_opened` overwrites Attributes to `redemption=opened` and wipes any other keys.

Not theft (both parties signed). It does let a negligent Bank permanently deface a full vault’s provenance.

Fix: close must introspect a prior `open_for_redemption` for the same asset, or set a per-tx flag.

**LOW — `mint_vault` `owner` is an `UncheckedAccount`.**  
Bank+payer can mint to any address, including the asset-signer PDA (`["mpl-core-execute", asset]`), which the authors already call bricked. Owner does not sign. Price is transferred before CreateV2 (atomic — OK). Cannot mint with `round_id == 0` or outside `[opens_at, closes_at)`.

Fix: `owner: Signer` (or require `owner != asset_signer`).

**LOW — leftover `fn burn_vault` in SEAL.**  
Not an instruction. Harmless until someone wraps it. Delete it.

---

**Claimed v1–v3 fixes (real vs relocated)**  
- Burn-on-`lamports==0`: **real**. Close never burns; BURN is a separate program.  
- Close owner check / provenance / collection match: **real** (`read_core_asset`).  
- ATA delegate / close-authority / T22 extensions / 1-lamport ATA grief: **real for derived reserve ATAs only**. Non-ATA still unchecked on close (accepted).  
- Mint plugin set: **real if** the hand-built CreateV2 matches pinned Core (disc 20, plugins 17+6, authority 3, `frozen=1`, Attributes authority = seal). Discriminators line up with current Core. I did not execute it.  
- Init front-run: **real** iff `INIT_AUTHORITY` is the live Squads key on the mainnet build.  
- Nested-vault guard: **relocated**, not fixed. Still “declared remaining_accounts only.” BURN even rejects *any* passed AssetV1, not “owned by this PDA.” Honesty in comments ≠ enumeration.

**Could not break**  
- Third party (not owner/bank/admin): no path to move, thaw, or seize.  
- Owner without Bank: no Execute, no open/close/burn-via-program (bare Core `BurnV1` still allowed — accepted).  
- Bank without Owner: nothing.  
- Open without a later close in the same tx: `NoTerminalClose`; if close fails, the thaw reverts. A successful tx cannot end thawed.  
- Leaving a *reserve ATA* delegate through honest close while SEAL still lists that mint.

Bank “sees every inner instruction” is overstated: a signature covers the *message*, not CPIs. ExecuteV1 → arbitrary program → `Approve` is invisible unless the Bank **simulates** before signing. That is the real 2-of-2.

**THE SINGLE THING:** Freeze SEAL `collection` (and the cbBTC reserve mint) at `initialize`, and derive `SEAL_PDA` from the SEAL program id in mint — then refuse to hold customer cbBTC until the Bank co-signer actually simulates inner CPIs and `getTokenAccountsByOwner` on every open/close/burn. Without that, the on-chain 2-of-2 is a door lock whose key is an off-chain script that does not exist in this repo.