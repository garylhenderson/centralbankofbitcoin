# Independent Security Audit — CBOB Vaults v6, Round 36

## R0. Round 35's Verdict and Repairs

Round 35 produced no quorum (NOT-COUNTED.md). The program change (`rescue_nested` + PermanentTransferDelegate) was reviewed adversarially (REVIEW-rescue.md) and modified per M1 (all rescues to Squads). The web/ pages were reviewed (REVIEW-web.md) with one HIGH and four MEDIUM confirmed, all claimed fixed.

**Verification of the rescue change against the current tree:**

The `rescue_nested` implementation in `programs/cbob-vault-mint/src/lib.rs` matches the reviewed design:
- Destination is always `a.config.bank_treasury` (line ~1842)
- Host must be the vault itself, positively burned, or a live CBOB vault
- Foreign live hosts refused with `HostUnresolved`
- `RescueNoProgress` removed (single destination makes it impossible)

The PermanentTransferDelegate is installed at `CreateV2` in `create_vault` with authority MINT's `["rescue"]` PDA. The rescue PDA signs only in `rescue_nested`.

**Web pages verification:**

The web/ tree shows the fixes claimed in REVIEW-web.md:
- H1 (stranger blocks opening): `plan-redeem.mjs` now refuses only reserve-account problems and nested CBOB vaults; everything else gets an acknowledgement box
- M1 (proxy relay): `rpc-proxy.mjs` now requires Origin, validates filter bytes, refuses without collection
- M2 (ceremony resume): `resolveCollection` scans chain for existing collections
- M3 (key paths in bundle): `build.mjs` strips notes, embeds only `{value, status}`
- M4 (local ceremony mode): `ceremony-local.mjs` + `mainnet-local` profile

**Remaining gaps in round 35 repairs:**

1. **The e2e-localnet test has not been run** (README says "for you to run; not run here"). The claim "80/80" in VALIDATION.md references `.cache/r35-web-e2e.log`, but the test file itself says it is not run by `run-all.mjs`. This is a measurement gap, not a code defect.

2. **The buy page has no voted-round e2e coverage** — only byte tests and mock-RPC browser run. The mock-RPC test does exercise the buy page's transaction building, but not against real programs.

---

## R1. Custody: Can Anyone But the Owner Get Value Out of a Sealed Vault?

### R1.1 The Open/Burn Pairing

**SEAL's `open_for_redemption`** walks the instructions sysvar from `current + 1` forward, looking for a top-level `burn_vault` with matching asset (account 0) and owner (account 2).

**BURN's `burn_vault`** walks from 0 to `current - 1`, looking for a top-level `open_for_redemption` with matching asset and owner.

**Attack surface analysis:**

1. **CPI wrappers**: Both programs use `load_instruction_at_checked` which sees only top-level instructions. A CPI wrapper cannot satisfy either half. The test-only wrapper (WR.1-WR.4) proves this.

2. **Two vaults in one transaction**: The pairing binds asset AND owner, so vault A's open cannot be satisfied by vault B's burn. Tested (3.9, 3.10, 4.10).

3. **Account-index binding**: Both programs pin the asset at index 0 and owner at index 2. The discriminators are asserted against `sha256("global:...")` in the suite.

4. **Instruction-sysvar parsing**: `load_current_index_checked` and `load_instruction_at_checked` are used correctly. The sysvar account is pinned by address in the account structs.

**Finding R1-A (LOW): The burn is not required to be the LAST instruction.**

SEAL's comment says "The burn is NOT required to be the last instruction." This means a transaction could be:
```
open A, sweep A, burn A, [arbitrary instructions]
```
The arbitrary instructions after the burn cannot touch vault A (it's burned), but they could include another redemption. This is by design and tested (4.9, 4.10a). Not a defect.

**Finding R1-B (LOW): No check that the open and burn are in the same "redemption sequence".**

Consider:
```
open A, open B, sweep A, burn A, sweep B, burn B
```
This is valid and tested. But also:
```
open A, open B, sweep B, burn B, sweep A, burn A
```
Is this valid? SEAL's forward walk finds burn A after open A. BURN's backward walk finds open A before burn A. Both pass. The sweeps are interleaved but each vault is swept before its own burn. This is fine.

What about:
```
open A, open B, sweep A, burn B, sweep B, burn A
```
SEAL for A: finds burn A later. SEAL for B: finds burn B later. BURN for A: finds open A earlier. BURN for B: finds open B earlier. But burn B happens while A is thawed and not yet swept. Does burn B's emptiness proof check A's accounts? No, it checks B's. So this transaction would fail at burn A's emptiness proof (A still has funds). The thaw reverts. Safe.

### R1.2 The Emptiness Proof

**BURN's emptiness proof** checks:
1. `asset_signer.lamports() == 0`
2. Every reserve mint's ATA under both token programs is declared
3. Declared accounts are PDA-owned, undelegated, extension-free, empty
4. No declared account is a live Core asset

**Attack surface:**

1. **Token-2022 extensions**: The reserve loop refuses `d.len() != 165`. The second loop (for non-reserve declared accounts) also refuses `d.len() != 165` for PDA-owned token accounts. This is correct.

2. **Delegates**: The reserve loop checks `d[72..76] == [0,0,0,0]` (delegate), `d[121..129] == [0u8; 8]` (delegated amount), `d[129..133] == [0,0,0,0]` (close authority). The second loop has the same checks.

3. **Close authorities**: Same as above.

4. **Lamports**: `asset_signer.lamports() == 0` is checked before the reserve loop.

5. **Nested Core assets**: The second loop refuses any declared account that is a live Core asset (`d[0] == KEY_ASSET_V1`).

6. **Declared-but-foreign accounts**: The second loop only checks accounts that are PDA-owned token accounts or Core assets. A declared account that is a System account with lamports is skipped (not PDA-owned, not a token account, not Core). This is correct — the burn only cares about what the vault PDA owns.

**Finding R1-C (LOW): A declared account that is a Token-2022 account owned by the PDA with extensions is refused, but a Token-2022 account owned by the PDA WITHOUT extensions (165 bytes) would pass the second loop's length check but fail the reserve loop's length check.**

Wait, let me re-read. The reserve loop:
```rust
if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
let d = acc.try_borrow_data()?;
if d.len() < TOKEN_ACCOUNT_LEN { continue; }
// ... checks owner, delegate, close authority
require!(d.len() == TOKEN_ACCOUNT_LEN, BurnError::ReserveHasExtensions);
```

So for a reserve mint's ATA under Token-2022, if the account exists and is 170 bytes (with ImmutableOwner), it's refused with `ReserveHasExtensions`. If it's 165 bytes (impossible for Token-2022 ATA, per measured fact), it would pass.

The second loop:
```rust
if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
let d = acc.try_borrow_data()?;
if d.len() >= TOKEN_ACCOUNT_LEN {
    let mut o = [0u8; 32]; o.copy_from_slice(&d[32..64]);
    if Pubkey::new_from_array(o) == pda {
        require!(d.len() == TOKEN_ACCOUNT_LEN, BurnError::ReserveHasExtensions);
        // ... same three checks
    }
}
```

This is consistent. A Token-2022 account with extensions (170 bytes) owned by the PDA is refused. A classic token account (165 bytes) owned by the PDA is checked for emptiness.

**Finding R1-D (INFO): The second loop skips accounts with `d.len() < TOKEN_ACCOUNT_LEN`.**

A Token-2022 account with a confidential balance extension might have a base `amount` field that reads zero but actually holds value. The second loop checks `d.len() == TOKEN_ACCOUNT_LEN` for PDA-owned accounts, so a 170-byte Token-2022 account is refused. But what about a Token-2022 account that is exactly 165 bytes? Token-2022 accounts always have at least the ImmutableOwner extension for ATAs (170 bytes), but a non-ATA Token-2022 account could theoretically be 165 bytes if it has no extensions. In that case, the base `amount` field is accurate. This is safe.

### R1.3 The Sweep Helper

**Finding R1-E (LOW): The sweep helper's lamport transfer to a destination below rent exemption.**

The helper does:
```rust
let lamports = signer.lamports();
if lamports > 0 {
    invoke(&system_instruction::transfer(signer.key, dest.key, lamports), ...)
}
```

If `dest` is a System account that doesn't exist yet and the lamports are below rent exemption, the transfer fails. The redeem page's canonical destination is the owner (who pays the fee and exists). A page that names any other destination must check it exists. This is documented in SPEC item 50.

**Finding R1-F (LOW): The sweep helper's lamport sweep can leave the asset-signer non-zero if a later instruction deposits.**

The helper reads `signer.lamports()` at execution time and transfers all of it. If a later instruction in the same transaction deposits lamports to the asset-signer, BURN's `lamports == 0` check would fail. But the sweep helper is called through Core ExecuteV1, and the burn follows immediately. A malicious instruction between the sweep and the burn could deposit lamports, causing the burn to fail (reverting the whole transaction). This is a griefing vector, not a theft vector — the attacker spends their own lamports to make the redemption fail.

**Finding R1-G (LOW): The sweep helper's pair list allows a source to also be a destination.**

If the same account appears as both source and destination in different pairs, the first pair transfers the balance out and closes the source. The second pair then tries to read the closed account, which fails. This reverts the whole transaction. Not a theft vector.

**Finding R1-H (INFO): The sweep helper refuses a destination wallet that is the vault's own asset-signer.**

```rust
if signer.key == dest.key { return Err(ProgramError::InvalidArgument); }
```

This is correct — sweeping to itself would be a no-op that leaves the vault non-empty.

### R1.4 Can a Thawed Vault Leave a Transaction Unburned?

**Finding R1-I (CRITICAL — needs verification): The open/burn pairing does not prevent a thawed vault from being transferred.**

SEAL's `open_for_redemption` thaws the vault. BURN's `burn_vault` requires a preceding open. But what if the transaction is:
```
open A, [Core TransferV1 of A to attacker], burn A
```

BURN checks that the asset's owner matches the `owner` signer. After the transfer, the owner is the attacker. If the attacker signs as owner, BURN passes. The vault is burned, and the attacker received... nothing? The transfer moved the NFT to the attacker, but the contents are in the asset-signer PDA, which follows the NFT. Then the burn destroys the NFT and the contents.

Wait, the transfer happens between open and burn. The attacker now owns the vault. The burn requires the owner's signature. If the attacker signs the burn, the vault is burned and the contents are destroyed. The attacker gained nothing.

But what if the attacker transfers the vault to themselves and then does NOT burn it? The transaction would be:
```
open A, [Core TransferV1 of A to attacker]
```
SEAL's forward walk looks for a burn after the open. There is no burn. SEAL refuses to thaw. The transfer never happens.

What if the attacker does:
```
open A, [Core TransferV1 of A to attacker], burn A
```
where burn A is signed by the attacker? SEAL's forward walk finds burn A with the attacker as owner. But SEAL's check is:
```rust
require_keys_eq!(asset_owner, owner, VaultError::NotTheOwner);
```
where `asset_owner` is read from the asset's current owner bytes. At the time SEAL runs, the asset is still owned by the original owner. The transfer hasn't happened yet (instructions execute in order). So SEAL checks the original owner. The burn's owner check also reads the current owner at burn time, which is now the attacker. The burn's preceding-open check looks for an open with the same asset and owner. The open had the original owner, not the attacker. So BURN refuses `NoPrecedingOpen`.

This is safe. The pairing binds the owner at both ends.

**Finding R1-J (LOW): A thawed vault can be transferred to a new owner who then burns it, but the original owner's signature is still required for the burn.**

Actually, re-reading BURN:
```rust
require_keys_eq!(asset_owner, ctx.accounts.owner.key(), BurnError::NotTheOwner);
```
where `asset_owner` is read from the asset's current owner bytes. If the asset was transferred between open and burn, the new owner must sign the burn. But the open was signed by the old owner. BURN's preceding-open check:
```rust
ix.accounts.get(SEAL_IX_OWNER_IDX).map(|a| a.pubkey) == Some(owner)
```
where `owner` is `ctx.accounts.owner.key()` (the new owner). The open's owner was the old owner. So this fails. Safe.

---

## R1s. The Sweep Helper

### (a) Access Control

The helper requires `signer.is_signer`. Called directly, the signer must be the asset-signer PDA, which nobody can sign for. Through Core ExecuteV1, Core signs as the asset-signer PDA only for the asset's owner.

**Finding R1s-A (LOW): The helper can be reached while the vault is still frozen.**

If called through Core ExecuteV1 on a frozen vault, Core's PermanentFreezeExecute plugin rejects the Execute. The helper never runs. Tested (SR.5, SR.5a).

But what if the helper is called directly with the asset-signer as signer? Nobody can sign for the PDA. Tested (SR.1).

### (b) The Pair List

**Finding R1s-B (LOW): A source that is also a destination in a different pair.**

As noted in R1-F, this reverts the transaction. Not a theft vector.

**Finding R1s-C (LOW): A destination that is not an ATA.**

The helper checks `to_owner == dest.key` and `to_mint == src_mint`. It doesn't check that the destination is an ATA. A non-ATA token account owned by the destination wallet with the same mint would pass. This is fine — the destination is chosen by the transaction builder (the owner).

**Finding R1s-D (INFO): A source with a delegate.**

The helper reads the token account and transfers from it. If the source has a delegate, the transfer still works (the PDA is the owner). The delegate doesn't block the transfer. The close also works. This is fine.

**Finding R1s-E (INFO): A frozen source.**

The token program refuses the transfer from a frozen account. The whole redemption reverts. Tested (SR.14).

### (c) Destination Checks

**Finding R1s-F (LOW): The destination wallet is not compared with the asset's owner.**

The helper doesn't know about the asset — it only sees the signer (asset-signer PDA) and the destination wallet. Through Core ExecuteV1, the transaction builder (the owner) chooses the destination. A malicious builder could send the funds to someone else, but that's the owner's choice. The helper's job is to move funds from the vault to wherever the owner says.

### (d) The Lamport Sweep

**Finding R1s-G (LOW): A later instruction can deposit lamports to the asset-signer after the sweep.**

As noted in R1-F, this causes the burn to fail (reverting the transaction). Griefing only.

### (e) Interaction with BURN's Emptiness Proof

The sweep closes the reserve accounts it empties. BURN's reserve loop:
```rust
let acc = ctx.remaining_accounts.iter().find(|a| a.key() == expected)
    .ok_or(BurnError::ReserveNotDeclared)?;
if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
```

If the account was closed by the sweep, it no longer exists. The `find` returns `None`, and BURN refuses `ReserveNotDeclared`. Wait, that's a problem!

Let me re-read. The sweep helper closes the source accounts. BURN requires every reserve mint's ATA to be DECLARED. If the account is closed, it doesn't exist, so it can't be declared. BURN would refuse.

But the suite passes (SR.4, S8.1). How?

Looking at the sweep helper:
```rust
invoke(&Instruction { program_id: SPL_TOKEN_ID, data: vec![IX_CLOSE_ACCOUNT], ... })
```

The close account instruction closes the account and transfers its lamports to the destination. After the close, the account no longer exists.

BURN's reserve loop:
```rust
let acc = ctx.remaining_accounts.iter().find(|a| a.key() == expected)
    .ok_or(BurnError::ReserveNotDeclared)?;
if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
```

If the account is closed, `find` returns `None`, and BURN refuses. But the suite passes!

Wait, let me look more carefully. When an account is closed, does it still exist? In Solana, closing an account sets its lamports to 0 and its data to empty. The account still exists as a System account with 0 lamports. So `find` would find it, but `acc.owner` would be the System program, not SPL Token. The check `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }` would skip it.

So the closed account passes because it's no longer a token account. This is the "skips an account no token program owns" behavior mentioned in the prompt.

**Finding R1s-H (LOW): A closed account passes BURN's check because it's no longer a token account, but the check is "skip" not "verify closed".**

If an attacker could make a reserve ATA not exist (or be a non-token account) while the vault still holds value elsewhere, BURN would skip it. But the reserve mints are fixed, and the ATA derivation is deterministic. The only way to make the ATA not exist is to close it, which requires the PDA's signature (through the sweep helper). The sweep helper only closes accounts it has emptied. So this is safe.

### (f) Does It Fit?

S8.0 measures 1,061 bytes for the three-asset redemption through the helper. The prompt says the page adds compute budget instructions (52 bytes) and a separate fee payer (96 bytes), totaling about 1,209 bytes. This fits in 1,232 bytes.

**Finding R1s-I (INFO): The measurement doesn't include a fourth reserve or the in-line monthly run's accounts.**

The reserve list is capped at 3 (MAX_RESERVE_MINTS), so a fourth reserve is impossible. The in-line monthly run is inside `retire_redeemed`, which is called by BURN. The pool account is already in the burn's account list. No additional accounts needed.

### (g) Evidence

SR.0-SR.4a and S8.* are in the suite. The helper is deployed from the same bytes as `scripts/build-mainnet.sh` proves (byte-identical between localnet and mainnet builds).

---

## R2. The Community Pool's Money

### The Invariant: Pool Always Holds at Least ceil(owed)

**Analysis of the accounting:**

`credit(c, avail, w, now)`:
- `delta = avail * ACC_SCALE / w`
- `acc_scaled += delta`
- `owed_scaled += delta * w`
- `last_distribute_at = now`
- `advance_epoch(c)`

`claim`:
- For each vault: `pending = owed_of(r, acc)`
- `pay = pending / ACC_SCALE` (floor)
- Transfers `pay` from pool to vault
- `r.carry_scaled = pending - pay * ACC_SCALE`
- `r.debt_scaled = weight_of(r) * acc`
- `owed_scaled -= pay * ACC_SCALE`

`retire`:
- `pending = owed_of(r, acc)`
- `owed_scaled -= pending`
- `total_active_weight -= w`
- `active_count -= 1`

**Finding R2-A (LOW): The invariant "pool >= ceil(owed)" can be violated by a bare burn between distributions.**

When a vault is bare-burned and retired, `retire` subtracts `pending` from `owed_scaled`. The pool balance doesn't change. So the pool holds MORE than owed. This is safe (over-collateralized).

When a vault is redeemed, `retire_redeemed` also subtracts `pending` from `owed_scaled`. The claim before the sweep pays the vault's share, reducing the pool balance and `owed_scaled` together. Safe.

**Finding R2-B (LOW): The `distribute` function's `PoolShort` check.**

```rust
let owed = ceil_sats(ctx.accounts.config.owed_scaled);
let avail = balance.checked_sub(owed).ok_or(MintError::PoolShort)?;
```

If the pool balance is less than `ceil(owed_scaled)`, `distribute` refuses. This maintains the invariant.

**Finding R2-C (LOW): The `monthly_inline` function's `saturating_sub`.**

```rust
let avail = balance.saturating_sub(ceil_sats(c.owed_scaled));
```

If the pool is short, `avail` is 0, and the monthly run does nothing. This is graceful degradation, not a violation.

**Finding R2-D (INFO): The `pending_count` and `pending_this_epoch` counters.**

`activate` (first call):
- `pending_count += 1`
- `pending_this_epoch += 1`
- `r.pending = true`
- `r.request_epoch = dist_epoch`

`join`:
- `pending_count -= 1`
- `r.pending = false`
- `r.active = true`

`retire` (for pending vault):
- `pending_count -= 1`
- If `request_epoch == dist_epoch`: `pending_this_epoch -= 1`
- `r.pending = false`

`advance_epoch`:
- `dist_epoch += 1`
- `pending_this_epoch = 0`

The `pending_this_epoch` counter is reset at each epoch. A vault that requested in epoch E and is retired in epoch E+1 would have `request_epoch != dist_epoch`, so `pending_this_epoch` is not decremented. But `pending_this_epoch` was already reset to 0 at the epoch boundary. This is correct.

**Finding R2-E (LOW): The `waiting_to_join` function.**

```rust
fn waiting_to_join(c: &MintConfig) -> Result<u64> {
    Ok(c.pending_count.checked_sub(c.pending_this_epoch).ok_or(MintError::Overflow)?)
}
```

If `pending_this_epoch > pending_count`, this underflows and returns an error. Can this happen?

`pending_count` is incremented on every activation request. `pending_this_epoch` is incremented on every activation request in the current epoch, and reset to 0 at each epoch boundary. So `pending_this_epoch <= pending_count` always holds. The `checked_sub` is defensive.

### Liveness

**Finding R2-F (LOW): A vault with a frozen cbBTC account can block its own redemption but not others'.**

A frozen vault account is skipped by `claim` (deferred). The vault stays owed. Its redemption would fail at the sweep (frozen account can't be emptied). This blocks that vault's redemption but not others'. Documented in SPEC item 28.

**Finding R2-G (LOW): A frozen pool blocks all claims that pay.**

`claim` transfers from the pool. A frozen pool refuses the transfer. The whole claim reverts. Documented in SPEC item 28.

**Finding R2-H (INFO): The `JoinWaitingFirst` gate can be triggered by a single unjoined vault.**

If one vault requested activation in an earlier epoch and hasn't been joined, no distribution can run. Anyone can join it with `claim`. The crank does this automatically. This is by design.

---

## R2b. The $CBOB Boost

### Exact N Distributions

**Finding R2b-A (LOW): A boost earns from the next distribution, not the current one.**

`boost_vault`:
```rust
let end = c.dist_epoch.checked_add(epochs as u64)?;
```

The boost ends at `dist_epoch + epochs`. The boost is active from the next distribution (epoch `dist_epoch + 1`) through epoch `dist_epoch + epochs`. That's exactly `epochs` distributions.

`expire_boost`:
```rust
require!(r.boost_weight > 0 && c.dist_epoch >= r.boost_end_epoch, MintError::BoostNotDue);
```

The boost is due when `dist_epoch >= boost_end_epoch`. At epoch `boost_end_epoch`, the boost has earned distributions `dist_epoch + 1` through `dist_epoch + epochs`, which is `epochs` distributions. Correct.

**Finding R2b-B (LOW): The `BoostsExpireFirst` gate.**

`distribute`:
```rust
require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst);
```

`monthly_inline`:
```rust
if c.boosts_due > 0 { return Ok(()); }
```

Both paths refuse to distribute while a boost is due. The boost must be expired first (free, anyone's). This ensures no distribution runs past a due boost.

**Finding R2b-C (LOW): The ring of 64.**

`advance_epoch`:
```rust
let i = (c.dist_epoch % BOOST_RING as u64) as usize;
c.boosts_due = c.boosts_due.checked_add(c.boost_expiring[i])?;
c.boost_expiring[i] = 0;
```

When epoch E advances, boosts ending at epoch E become due. The ring slot is `E % 64`. A boost bought at epoch `e` with `n` distributions ends at `e + n`. The ring slot is `(e + n) % 64`. Since `n <= 63`, two live boosts can't share a ring slot (the ring is 64). Correct.

**Finding R2b-D (LOW): `total_active_weight` and `boost_weight_total` agreement.**

`reweigh`:
```rust
c.total_active_weight = c.total_active_weight - before + after;
```

`boost_vault`:
```rust
c.boost_weight_total += extra;
reweigh(c, r, extra)?;
```

`expire_boost`:
```rust
unschedule_boost(c, r)?;  // decrements boost_weight_total
reweigh(c, r, 0)?;        // decrements total_active_weight by extra
```

`unschedule_boost`:
```rust
c.boost_weight_total -= r.boost_weight;
```

The host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` verifies this over 260 epochs.

**Finding R2b-E (INFO): A boost can be expired early by retiring the vault.**

`retire` calls `unschedule_boost` if the vault has a boost. This removes the boost from the schedule. The boost's remaining distributions are forfeited. This is by design (the vault is gone).

---

## R3. The Level Draw

### SlotHashes Parse

**Finding R3-A (LOW): The SlotHashes parse is defensive.**

`blockhash_in_window`:
- Checks the account key is the SlotHashes sysvar
- Checks `data.len() >= 8`
- Reads the count, checks `n <= 512`
- Checks `data.len() >= 8 + n * 40`
- Iterates entries, finds the smallest slot in `[want, want + 64]`
- Refuses all-zero hashes

This is correct.

### Skipped-Slot Handling

**Finding R3-B (INFO): The skipped-slot handling is deterministic.**

`try_capture` uses `blockhash_in_window` which finds the smallest produced slot in `[want, want + MAX_SKIPPED_SLOTS]`. This is deterministic because which slots were produced is settled before the capture runs.

### FIFO

**Finding R3-C (LOW): The FIFO is strict.**

`reveal_level`:
```rust
require!(index == ctx.accounts.config.revealed_total, MintError::RevealOutOfOrder);
```

Only the vault at `revealed_total` can be revealed. After reveal, `revealed_total` increments. This is strict FIFO.

### Burned Vault at Head of Queue

**Finding R3-D (INFO): A burned vault still takes its draw.**

`reveal_level`:
```rust
let burned = {
    let a = &ctx.accounts.asset;
    let d = a.try_borrow_data()?;
    *a.owner == MPL_CORE_ID && d.len() == 1 && d[0] == 0
};
if !burned {
    // ... update Core attributes
}
```

The level is still drawn and counted, but the Core update is skipped. The FIFO doesn't stop. Tested (L.11).

### Attribute Re-supply Hash

**Finding R3-E (LOW): The attribute hash is checked.**

`reveal_level`:
```rust
require!(hashv(&[&attributes.try_to_vec()?]).to_bytes() == hash, MintError::AttributesMismatch);
```

The caller must re-supply the exact attributes stored at mint. The hash is computed at mint and stored in the record.

### What a Minter, Crank Operator, or Slot Leader Can Influence

**Finding R3-F (INFO): The C leader's influence is as documented in SPEC item 26.**

The C leader can skip its own slots and vary block contents to choose among many draws. This is an accepted limit.

**Finding R3-G (LOW): The reschedule mechanism gives a minter a re-roll if nobody captures.**

As documented in SPEC item 25. The minter can compute their draw from public slot hashes and decline to capture, hoping nobody else does. If the window lapses, the reschedule gives a fresh roll.

---

## R4. Governance

### Minority Carrying What It Should Not

**Finding R4-A (LOW): The key-change supermajority is based on the snapshot, not live supply.**

`execute_proposal`:
```rust
let key_change = p.actions.iter().any(|a| matches!(a,
    ProposalAction::Brakes { set_guardian: true, .. } | ProposalAction::ArmSwapOperator { .. }));
if key_change {
    let need_key = divisor.checked_mul(KEY_CHANGE_YES_BPS)...;
    require!(need_key > 0 && (p.yes as u128) >= need_key, GovError::KeyChangeNeedsHalf);
}
```

`divisor` is `p.quorum_supply`, which is the live supply at proposal creation. Vaults minted during the vote can't vote (`VaultTooNew`) and don't raise the bar. This is documented in SPEC (round 25 D1).

**Finding R4-B (LOW): The guardian change and swap operator arm can't share a proposal.**

`create_proposal`:
```rust
require!(!(changes_guardian && arms_operator), GovError::KeyChangesBundled);
```

This prevents the red-team 2 attack (remove the brake and arm the thief in one vote).

### Vote Reaching Money It Should Not

**Finding R4-C (INFO): The vote can only reach what's in the ProposalAction enum.**

The enum has SetRound, Brakes, TightenSweep, ArmSwapOperator, SetBoostTerms. No action touches the split, destinations, max_supply, or royalty. The `update_wiring` instruction is deleted.

### Governance Frozen Forever

**Finding R4-D (LOW): A stolen guardian key can stop sales and sweep permanently if turnout is below half.**

As documented in SPEC item 47. The guardian can re-stop after every restart vote. If fewer than half of all live vaults vote to replace the guardian, the stop is permanent. This is an accepted limit.

**Finding R4-E (INFO): If every vault is redeemed, governance can't act.**

As documented in SPEC item 45. A proposer must show a live vault. If all vaults are redeemed, no proposal can be created. A round still open can mint one.

---

## R5. The Charter Claim

### Proof of Burn Verification

**Finding R5-A (LOW): The Merkle proof is domain-separated and sorted.**

`merkle_leaf` uses tag 0x00, `merkle_root_from` uses tag 0x01. Pairs are sorted. This prevents the classic second-preimage attack.

**Finding R5-B (LOW): The Proof of Burn is burned as its owner.**

`claim_charter_vault`:
```rust
let mut o = [0u8; 32]; o.copy_from_slice(&d[1..33]);
require_keys_eq!(Pubkey::new_from_array(o), ctx.accounts.owner.key(), MintError::NotThePobOwner);
```

The owner must sign and must own the Proof of Burn. The burn CPI uses the owner as authority.

### The Hot Wallet's Powers

**Finding R5-C (INFO): SPEC item 46 is complete.**

The hot wallet can:
1. End the project before it starts (rejecting hook through the window)
2. Capture governance (admitting only its own Proofs of Burn)

It cannot:
- Transfer or burn individual Proofs of Burn (Core refuses)
- Add PermanentBurnDelegate or PermanentTransferDelegate after creation (Core refuses)

The alarm watches the collection but not individual assets. The alarm samples state (30-minute gap). These are documented.

**Finding R5-D (LOW): The alarm doesn't watch individual Proof of Burn assets.**

As documented in SPEC item 46 (round 22 note). A plugin added to an individual Proof of Burn is not paged. The hot wallet could add a rejecting hook to specific assets.

---

## R6. One-Time Configuration

### Initialize Values

**Finding R6-A (LOW): SEAL's initialize accepts off-curve keys for the collection.**

SEAL's `initialize` takes `collection: Pubkey` and doesn't check if it's on-curve. The collection is a Core collection account, which is typically off-curve (a PDA or a generated keypair). This is fine.

**Finding R6-B (LOW): SEAL's initialize doesn't check the collection key.**

SEAL's `initialize`:
```rust
pub fn initialize(ctx: Context<Initialize>, collection: Pubkey, reserve_mints: Vec<Pubkey>) -> Result<()> {
    require_keys_eq!(ctx.accounts.authority.key(), INIT_AUTHORITY, VaultError::NotTheInitAuthority);
    require!(reserve_mints.len() <= MAX_RESERVE_MINTS, VaultError::TooManyReserveMints);
    require!(!reserve_mints.is_empty(), VaultError::NoReserveMints);
    assert_classic_spl(&reserve_mints, ctx.remaining_accounts)?;
    let c = &mut ctx.accounts.config;
    c.version = CONFIG_VERSION;
    c.collection = collection;
    c.reserve_mints = reserve_mints;
    c.bump = ctx.bumps.config;
    Ok(())
}
```

The collection is not checked against anything. MINT and BURN check it against their own configs (`WiringDiverged`). A wrong collection in SEAL would be caught by MINT's `check_seal_wiring` and BURN's initialize. Documented in SPEC (round 24 A6).

**Finding R6-C (LOW): SEAL's initialize doesn't check for duplicate reserve mints.**

`assert_classic_spl` checks each mint's owner but not duplicates. A duplicate would mean the reserve list has the same mint twice. BURN's reserve loop would check the same ATA twice (both derivations), which is harmless. The launch checker pins the exact three mints.

### The Swap Operator's Worst Case

**Finding R6-D (INFO): The swap operator's worst case is documented in SPEC item 10.**

The operator can sweep up to `max_sweep_lamports` (10 SOL) per `sweep_cooldown_secs` (6 hours) until the guardian stops the sweep. The operator must sign. A vote can only tighten the bounds.

### The 10% Royalty

**Finding R6-E (INFO): The royalty is immutable in Core.**

The Royalties plugin is installed with `PluginAuthority::None`. Core refuses every update and removal. Tested (R.5, R.6, R.6a, R.6b, R.6c).

### The Redemption Cap

**Finding R6-F (LOW): The rolling window is exactly that.**

`burn_vault`:
```rust
let k = (cap.max(1) as usize).min(RATE_RING);
let head = c.rate_head as usize % RATE_RING;
let kth = c.rate_ring[(head + RATE_RING - k) % RATE_RING];
require!(now.checked_sub(kth)? >= c.redeem_window_secs, BurnError::RateLimited);
c.rate_ring[head] = now;
c.rate_head = ((head + 1) % RATE_RING) as u8;
```

The k-th most recent redemption must be at least a full window old. This is a true rolling window. Tested (RL.2, RL.3, RL.4, RL.7).

---

## R7. Cross-Program Raw Reads

### Offset Verification

**Finding R7-A (INFO): All offsets recomputed and verified.**

I recomputed the key offsets:

**SEAL Config (version 2):**
- Discriminator: 0..8
- version: 8
- collection: 9..41
- reserve_mints (Vec<Pubkey>): 41.. (u32 length at 41, keys at 45..)
- bump: after reserve_mints

MINT reads:
- `OFF_VERSION = 8` ✓
- `OFF_COLLECTION = 9` ✓
- `OFF_RESERVES = 41` ✓

BURN reads:
- `OFF_VERSION = 8` ✓
- `OFF_COLLECTION = 9` ✓
- `OFF_RESERVES = 41` ✓

**MINT Config (version 6):**
- Discriminator: 0..8
- version: 8
- collection: 9..41
- governance: 41..73
- pool_ata: 73..105
- round_id: 105..109
- opens_at: 109..117
- closes_at: 117..125
- price: 125..133
- cap: 133..137
- minted_this_round: 137..141
- minted_total: 141..149
- max_supply: 149..157
- bank_treasury: 157..189
- split_bps: 189..191
- sales_stopped: 191
- sweep_stopped: 192
- guardian: 193..225
- swap_operator: 225..257
- sol_reserve_lamports: 257..265
- bump: 265
- max_sweep_lamports: 266..274
- sweep_cooldown_secs: 274..282
- last_sweep_at: 282..290
- level_caps: 290..310
- level_minted: 310..330
- revealed_total: 330..338
- payment_mint: 338..370
- pob_collection: 370..402
- pob_root: 402..434
- charter_opens_at: 434..442
- charter_closes_at: 442..450
- charter_claimed: 450..454
- bare_burns_retired: 454..462
- total_active_weight: 462..470
- active_count: 470..478
- acc_scaled: 478..494
- owed_scaled: 494..510
- last_distribute_at: 510..518
- sales_stopped_at: 518..526
- sweep_stopped_at: 526..534
- pending_swap_operator: 534..566
- pending_swap_operator_at: 566..574
- monthly_secs: 574..582
- pending_guardian: 582..614
- pending_guardian_set: 614
- pending_guardian_at: 615..623
- notice_secs: 623..631
- sweep_floor_lamports: 631..639
- cooldown_ceiling_secs: 639..647
- reserve_ceiling_lamports: 647..655
- dist_epoch: 655..663
- pending_count: 663..671
- pending_this_epoch: 671..679
- cbob_mint: 679..711
- max_boost_weight: 711
- max_boost_epochs: 712..714
- boost_price: 714..722
- boost_weight: 722
- boost_epochs: 723..725
- boosts_active: 725..729
- boosts_due: 729..733
- boost_weight_total: 733..741
- cbob_burned_total: 741..749
- boost_expiring: 749..1005 (64 * 4 bytes)

GOV reads:
- `OFF_MINT_VERSION = 8` ✓
- `OFF_MINT_COLLECTION = 9` ✓
- `OFF_MINT_SALES_STOPPED = 191` ✓
- `OFF_MINT_SWEEP_STOPPED = 192` ✓
- `OFF_MINT_SALES_STOPPED_AT = 518` ✓
- `OFF_MINT_SWEEP_STOPPED_AT = 526` ✓
- `OFF_MINT_SWEEP_FLOOR = 631` ✓
- `OFF_MINT_COOLDOWN_CEILING = 639` ✓
- `OFF_MINT_RESERVE_CEILING = 647` ✓
- `OFF_MINT_MAX_BOOST_WEIGHT = 711` ✓
- `OFF_MINT_MAX_BOOST_EPOCHS = 712` ✓
- `OFF_MINT_GOVERNANCE = 41` ✓
- `OFF_MINT_MINTED_TOTAL = 141` ✓
- `OFF_MINT_BARE_RETIRED = 454` ✓
- `OFF_MINT_CHARTER_CLOSES = 442` ✓
- `OFF_MINT_SOL_RESERVE = 257` ✓
- `OFF_MINT_MAX_SWEEP = 266` ✓
- `OFF_MINT_COOLDOWN = 274` ✓

BURN reads:
- `OFF_MINT_VERSION = 8` ✓
- `OFF_MINT_MINTED_TOTAL = 141` ✓
- `OFF_MINT_BARE_RETIRED = 454` ✓

**BURN Config (version 4):**
- Discriminator: 0..8
- version: 8
- collection: 9..41
- bump: 41
- burned_total: 42..50
- redeem_window_secs: 50..58
- rate_head: 58
- rate_ring: 59..571 (64 * 8 bytes)

GOV reads:
- `OFF_BURN_VERSION = 8` ✓
- `OFF_BURN_TOTAL = 42` ✓

**VaultRecord (version 4):**
- Discriminator: 0..8
- version: 8
- asset: 9..41
- mint_index: 41..49
- reveal_slot: 49..57
- level: 57
- charter: 58
- entropy_set: 59
- entropy: 60..92
- attrs_hash: 92..124
- bump: 124
- active: 125
- retired: 126
- reschedules: 127..129
- vault_ata: 129..161
- debt_scaled: 161..177
- pending: 177
- request_epoch: 178..186
- boost_weight: 186
- boost_end_epoch: 187..195
- carry_scaled: 195..211

GOV reads:
- `OFF_REC_VERSION = 8` ✓
- `OFF_REC_ASSET = 9` ✓
- `OFF_REC_INDEX = 41` ✓

All offsets are correct.

---

## R8. The Suite, Simulation, and Build as Evidence

### Arms That Cannot Fail

**Finding R8-A (LOW): The `because()` pins can pass for the wrong reason if the error text appears in a different context.**

The `because()` function checks if the recorded error contains the expected code. If the error is from a different instruction in the same transaction, the pin could pass incorrectly. The suite mitigates this by using unique assertion IDs and checking the full error text.

**Finding R8-B (INFO): The `ID.1` assertion checks for unique IDs.**

```typescript
const seen = new Map<string, number>(); for (const r of R) if (!r.id.endsWith('!')) seen.set(r.id, (seen.get(r.id) ?? 0) + 1)
rec('ID.1', 'every assertion id in this suite is unique', '[]', JSON.stringify([...seen].filter(([, n]) => n > 1).map(([k]) => k)))
```

This prevents the round-23 bug where a reused ID made a reason pin read another arm's error.

### Claims Not Exercised

**Finding R8-C (INFO): The 7-day proposal execution deadline is not exercised.**

SPEC says "The 7-day proposal execution deadline is NOT exercised by the test suite" (it's a constant, not an initialize value). The sibling (round already over is skipped) is tested.

**Finding R8-D (INFO): The 3600-second redemption window is not separately exercised.**

The suite uses a 10-second window. The 3600-second value is the same arithmetic. Documented in SPEC item 32.

### Build Provenance

**Finding R8-E (INFO): The sweep helper's bytes are proven identical between localnet and mainnet builds.**

`scripts/build-mainnet.sh` compares the sweep helper's mainnet bytes with the localnet bytes and with `target/deploy`. The four keyed programs are proven to carry the right INIT_AUTHORITY by behavioral probe.

**Finding R8-F (LOW): The four keyed programs' localnet and mainnet builds are not byte-compared.**

`build-mainnet.sh` compares only the sweep helper with `cmp`. For the four keyed programs, the localnet rebuild is only asked about the key. The mainnet build is not compared against the localnet build. This is a known gap (round 35 C12, INFO).

---

## Accepted Limits: The Four Questions

### 1. Is any limit WORSE than stated?

**Limit 9 (foreign Core asset nested):** The limit says "nothing refuses the redemption either." With `rescue_nested`, a nested CBOB vault is no longer destroyed. But a FOREIGN Core asset nested in a vault is still destroyed on redemption. The redeem page's `judgeRedemptionCoverage` can warn, but the page is not built (item 50). The limit is accurate.

**Limit 25 (minter re-roll):** The limit says "PROVIDED no one else captures in the ~300-slot window." The crank runs every minute, and capture rides on four host instructions. The window is about 2 minutes. The limit is accurate.

**Limit 26 (C leader grinding):** The limit says C's leader can "CHOOSE AMONG MANY DRAWS." The analysis in SPEC (best-of-4 takes P(Level V) from 5.0% to 18.6%) is correct. The limit is accurate.

**Limit 28 (Coinbase freeze):** The limit says a frozen vault account blocks the whole redemption. With the sweep helper, a frozen reserve account still blocks the redemption (the helper's transfer fails). The limit is accurate.

**Limit 41 (leaked custodial key):** The limit says transfers are not limited. The redemption cap only bounds redemptions. A thief can transfer vaults at will. The limit is accurate.

**Limit 44 (undeclared airdrops destroyed):** The limit says Token-2022 accounts and frozen strays are not covered by the sweep helper. The redeem page (when built) will handle classic strays but not Token-2022 or frozen strays. The limit is accurate.

**Limit 46 (hot wallet):** The limit says the hot wallet can end the project or capture governance. With the alarm watching the collection (but not individual assets), the limit is accurate. The 30-minute sampling gap is documented.

**Limit 47 (stolen guardian):** The limit says the stop can be permanent at low turnout. The key-change needs half of all live vaults. If turnout is below half, the guardian keeps the key. The limit is accurate.

**Limit 55 (unsplit revenue):** The limit says a vault can share unsplit revenue. The crank splits every pass, bounding the unsplit balance. The limit is accurate.

**Limit 56 (hot $CBOB key):** The limit says anyone who reads the file can move every $CBOB. The file is on the box and in backups. The limit is accurate.

**Limit 58 (rescue to Squads):** The limit says the Squads could vote with a vault it holds. This is a custody rule, not a program rule. The limit is accurate.

### 2. Is anything listed as a limit not actually a limit?

**Limit 35 (10% turnout never binds):** With quorum 21% and threshold 51%, the smallest passing vote is 10.71% YES. The 10% turnout rule never binds. This is correct — it's listed as a limit but is actually a floor that doesn't bind at the ruled numbers.

**Limit 42 (prior transaction for ATAs):** The limit says the fully padded shape with all three creates doesn't fit. The narrower owner-payer shape does fit (1,219 bytes). The limit is accurate but notes the narrow variant is not the page contract.

### 3. Is any DISCHARGED item not actually discharged?

**Item 12/17 (compute units):** Discharged by measurement. The suite measures CU on landed transactions. The 400,000 CU regression ceiling is generous. This is discharged.

**Item 14 (duplicate attributes):** Closed on chain. `check_attributes` refuses duplicates. This is discharged.

**Item 19 (unlevelled vault halt):** Closed by construction. No state where a vault is activated but unlevelled. This is discharged.

**Item 51 ($CBOB boost):** Decided and built. The boost is in MINT and GOV. This is discharged.

**Item 54 (compute at widest host shapes):** Measured. The crank is unaffected. Holder pages must set the CU limit. This is discharged.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**Item 22 (live chain distribution):** Still OPEN. The dress rehearsal must exercise the crank and revenue cycle. Not quietly accepted.

**Item 38 (initialize values):** Still OPEN. The charter opening date and lock deadline are not set. Not quietly accepted.

**Item 50 (holder surfaces):** Still OPEN. The web/ pages are built but not published. The e2e test has not been run. Not quietly accepted.

**Item 52 (pool and Squads accounts):** Still OPEN. Road step 10 creates them. Not quietly accepted.

**Item 53 (dress rehearsal):** Still OPEN. The rehearsal tree script exists but the rehearsal value set is not written. Not quietly accepted.

---

## New Findings

### Finding N1 (MEDIUM): The redeem page's `planRedemption` can be bypassed by a direct transaction, and the holder guide's promise "Only open your vault on the Bank's redeem page" is not enforceable.

**Where:** `web/src/lib/plan-redeem.mjs`, `HOLDER-GUIDE.md`

**What:** The holder guide says "Only open your vault on the Bank's redeem page. Burning the NFT any other way destroys everything inside it forever." But nothing on chain prevents a holder from building their own redemption transaction. The programs accept any well-formed redemption. The redeem page's protections (coverage check, sweep helper, prior transaction) are client-side only.

**Evidence:** A holder could use any Solana wallet to build the redemption transaction manually. The programs would accept it if it's well-formed. The sweep helper is permissionless (anyone can call it through Core ExecuteV1).

**Fix:** This is a documentation issue, not a code defect. The holder guide should say "The redeem page is the safest way to open your vault" rather than "Only open your vault on the Bank's redeem page."

### Finding N2 (LOW): The `planRedemption` function's handling of a frozen pool with an owed share.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** When the pool is frozen and the vault is owed a share, the plan adds an acknowledgement (`forfeit`). But the acknowledgement text says "They go back to the pool for the vaults that remain." This is accurate — `retire_redeemed` forfeits the share when the pool is frozen. But the holder might not understand that waiting for the pool to thaw would let them keep the share.

**Evidence:** The text says "Wait for the pool to be unfrozen to keep them." This is clear enough.

**Fix:** None needed.

### Finding N3 (LOW): The `planRedemption` function's handling of a C5 account (foreign close authority) with a zero balance.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** A C5 account with zero balance is skipped (not in `helperStrays` or `transferStrays`). It's not declared to BURN. BURN's second loop skips it because it's a token account owned by the PDA with zero balance. This is correct — nothing is lost.

**Evidence:** The test `C5 with a ZERO balance: nothing to do, nothing refused, not declared` passes.

**Fix:** None needed.

### Finding N4 (LOW): The `planRedemption` function's handling of a frozen stray with a balance.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** A frozen stray with a balance is added to `cannot` and gets an acknowledgement. The text says "Nothing can move them, so they are lost when the vault is opened." This is accurate — the token program refuses transfers from frozen accounts.

**Evidence:** The test `C5 FROZEN with a balance: NOT refused; named in a box to tick` passes.

**Fix:** None needed.

### Finding N5 (INFO): The `planRedemption` function's `covered` set includes reserve accounts but not the C5 transfer accounts.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The `covered` set is used for `judgeRedemptionCoverage`. Reserve accounts are added to `covered`. C5 transfer accounts are added to `covered` after the packet-fitting loop. But the C5 accounts are left undeclared in the burn. `judgeRedemptionCoverage` would flag them as uncovered. The code handles this by adding them to `covered`:
```javascript
for (const a of [...hs, ...ts]) { covered.add(a.address); needOwnerAta.add(a.parsed.mint) }
```

This is correct — the C5 accounts are "covered" by the transfer, even though they're not declared to BURN.

**Evidence:** The test `C5: the coverage judgement passes` confirms this.

**Fix:** None needed.

### Finding N6 (LOW): The `planRedemption` function's packet-fitting loop can leave a stray in `left` even when it would fit if the C5 transfers were reordered.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The loop pops from `ts` (C5 transfers) first, then `hs` (helper strays). If the packet is full, the last C5 transfer is left behind. But a C5 transfer is smaller than a helper pair (one Core Execute vs. one Core Execute with a helper instruction). Reordering might fit more. This is a minor optimization issue, not a correctness issue.

**Evidence:** The test `8 strays: every stray is either moved or named in an acknowledgement` passes.

**Fix:** None needed.

### Finding N7 (LOW): The `planRedemption` function's `noPrior` flag can cause a stray to be left behind even when its destination ATA exists.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The `canReceive` function checks `s.noPrior || s.ownerAtaExists.has(...)`. If `noPrior` is true (re-plan), a stray whose destination ATA doesn't exist is left behind. But the destination ATA might have been created by the prior transaction. The `ownerAtaExists` set is from the snapshot, which is read fresh. This should be correct.

**Evidence:** The test `L2: a stray of a NEW mint arriving after the set-up` passes.

**Fix:** None needed.

### Finding N8 (INFO): The `planRedemption` function's `judgeRedemptionCoverage` cross-check.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The cross-check runs `judgeRedemptionCoverage` over `owned` (all PDA token accounts and nested assets) with `covered` (reserve accounts and swept strays). If the coverage check finds something not already named, the page refuses. This is defense in depth.

**Evidence:** The test `plain: the coverage judgement (bank/detectors.mjs) passes` confirms this.

**Fix:** None needed.

### Finding N9 (LOW): The `planRedemption` function's rate limit note.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The rate limit note says "The next opening is possible from [time]." This is computed from the k-th most recent redemption time plus the window. But the cap might change if live supply changes (more redemptions or bare burns). The note is a snapshot, not a guarantee.

**Evidence:** The test `rate limit: the page says when the next opening is possible` passes.

**Fix:** None needed.

### Finding N10 (LOW): The `planRedemption` function's handling of a vault with no record.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If `s.record` is null, the plan refuses with "The Bank has no record for this vault." This is correct — every vault has a record created at mint.

**Evidence:** The test `retired record: refused` passes.

**Fix:** None needed.

### Finding N11 (INFO): The `planRedemption` function's handling of a vault with a pending activation.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** A pending vault gets a note: "This vault has asked to join the payouts and has not joined yet, so it is owed nothing." This is accurate — a pending vault has no weight and is owed nothing.

**Evidence:** The test `a vault waiting to join: no claim, a note` passes.

**Fix:** None needed.

### Finding N12 (LOW): The `planRedemption` function's handling of a vault with an unreadable reserve account.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If a reserve account exists but can't be parsed, the plan refuses. This is correct — the sweep helper needs to read the account to transfer from it.

**Evidence:** The test `the vault's OWN reserve account unreadable: refused` passes.

**Fix:** None needed.

### Finding N13 (LOW): The `planRedemption` function's handling of a reserve account with a foreign close authority.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If a reserve account has a close authority that's not the PDA, the plan refuses. This is correct — the sweep helper would fail to close the account.

**Evidence:** The test `the vault's OWN cbBTC frozen by Coinbase with a balance: refused` passes (for frozen). The close authority case is similar.

**Fix:** None needed.

### Finding N14 (INFO): The `planRedemption` function's handling of a vault with a nested CBOB vault.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** A nested CBOB vault causes a refusal pointing at the rescue. This is correct — the rescue moves the nested vault to the Squads.

**Evidence:** The test `a VAULT nested inside: refused, pointing at the rescue` passes.

**Fix:** None needed.

### Finding N15 (LOW): The `planRedemption` function's handling of a foreign NFT.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** A foreign NFT gets an acknowledgement saying it's destroyed. The text says "This page does not move NFTs out of a vault, so it is DESTROYED when the vault is opened." This is accurate — the burn destroys everything in the asset-signer PDA.

**Evidence:** The test `a foreign NFT inside: needs an explicit acknowledgement` passes.

**Fix:** None needed.

### Finding N16 (LOW): The `planRedemption` function's handling of compressed NFTs.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** Compressed NFTs are listed via DAS. If DAS doesn't answer, a note says "could not look for compressed NFTs." If DAS answers, compressed NFTs get acknowledgements. This is correct.

**Evidence:** The test `compressed NFTs NOT checked: said plainly, not silently skipped` passes.

**Fix:** None needed.

### Finding N17 (INFO): The `planRedemption` function's handling of a vault with no token accounts.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If the vault has no token accounts, the reserve pairs are still built (the sweep helper names them, but they don't exist). The prior transaction creates them. This is correct.

**Evidence:** The test `missing accounts: the PRIOR transaction creates the vault's 2 missing reserve accounts` passes.

**Fix:** None needed.

### Finding N18 (LOW): The `planRedemption` function's handling of a vault with a frozen pool and no owed share.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If the pool is frozen and the vault is owed nothing, no claim is sent and no acknowledgement is needed. This is correct — the vault can be redeemed without a claim.

**Evidence:** The test `pool frozen, nothing owed: no acknowledgement` passes.

**Fix:** None needed.

### Finding N19 (INFO): The `planRedemption` function's handling of a vault with a frozen pool and an owed share.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If the pool is frozen and the vault is owed a share, the plan adds a `forfeit` acknowledgement. The redemption proceeds without a claim. `retire_redeemed` forfeits the share. This is correct.

**Evidence:** The test `pool frozen: the 20 credited sats are named in an acknowledgement` passes.

**Fix:** None needed.

### Finding N20 (LOW): The `planRedemption` function's handling of a vault with a frozen reserve account holding zero.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** A frozen reserve account with zero balance is not refused. The sweep helper's transfer is skipped (amount is 0), but the close still happens. A frozen account can be closed? Let me check.

The sweep helper:
```rust
if amount > 0 {
    // transfer
}
invoke(&Instruction { program_id: SPL_TOKEN_ID, data: vec![IX_CLOSE_ACCOUNT], ... })
```

The close happens regardless of the amount. Can a frozen account be closed? In SPL Token, `CloseAccount` checks that the account is not frozen? Let me check the SPL Token source.

Actually, SPL Token's `CloseAccount` does NOT check the frozen state. It checks that the account has no delegate and no close authority (or the close authority is the signer). A frozen account with zero balance can be closed.

But wait, the test `a frozen stray holding ZERO: nothing to tick, nothing refused` passes. And the test `the vault's OWN cbBTC frozen by Coinbase with a balance: refused` passes. What about a frozen reserve account with zero balance?

The plan doesn't refuse it. The sweep helper would close it. BURN would skip it (closed account is no longer a token account). This is correct.

**Evidence:** The test `a frozen stray holding ZERO: nothing to tick, nothing refused` passes.

**Fix:** None needed.

---

## Web Pages: New Findings

### Finding W1 (MEDIUM): The `planRedemption` function's `covered` set doesn't include the C5 transfer accounts until after the packet-fitting loop, but the `judgeRedemptionCoverage` cross-check runs after.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The `covered` set is built from reserve accounts. C5 transfer accounts are added after the packet-fitting loop:
```javascript
for (const a of [...hs, ...ts]) { covered.add(a.address); needOwnerAta.add(a.parsed.mint) }
```

But `left` accounts (those that didn't fit) are NOT added to `covered`. The cross-check:
```javascript
const judged = judgeRedemptionCoverage(owned, [...covered])
```

If a `left` account is a classic token account with a balance, `judgeRedemptionCoverage` would flag it as uncovered. The code handles this by checking that the coverage reasons are already named in the acknowledgements:
```javascript
for (const reason of judged.reasons)
    if (![...named].some(a => a && reason.includes(a))) refuse.push(...)
```

The `left` accounts are named in `ack` with `id: left:${a.address}`. The `named` set includes `ack.map(a => a.id.split(':').slice(1).join(':'))`. So `left:${address}` becomes `${address}` in the named set. The coverage reason includes the address. This should match.

**Evidence:** The test `8 strays: every stray is either moved or named in an acknowledgement` passes.

**Fix:** None needed.

### Finding W2 (LOW): The `planRedemption` function's `noAccount` handling.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The `noAccount` array contains strays whose destination ATA doesn't exist and `noPrior` is true. These are removed from `helperStrays` and `transferStrays` and added to `ack` with `left:${address}`. But the text says "It arrived after the first check, and taking it out would need another set-up transaction." This is accurate.

**Evidence:** The test `L2: a stray of a NEW mint arriving after the set-up` passes.

**Fix:** None needed.

### Finding W3 (INFO): The `planRedemption` function's `ownerAtaExists` set.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The `ownerAtaExists` set is built from the snapshot's `ownerAtaExists`. This is read fresh in `readRedemptionSnapshot`. The set contains the owner's ATAs for all reserve mints and stray mints. This is correct.

**Evidence:** The test `missing accounts: the PRIOR transaction creates the vault's 2 missing reserve accounts and the owner's 3` passes.

**Fix:** None needed.

### Finding W4 (LOW): The `planRedemption` function's `prior` transaction packing.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The prior transactions are packed to fit 1,232 bytes. Each prior transaction contains ATA creates. The packing is greedy — if adding an instruction exceeds the limit, a new transaction is started. This is correct.

**Evidence:** The test `missing accounts: every prior transaction fits` passes.

**Fix:** None needed.

### Finding W5 (INFO): The `planRedemption` function's `legacySize` uses a dummy blockhash.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** `legacySize` uses `DUMMY_BLOCKHASH = '11111111111111111111111111111111'`. The serialized size doesn't depend on the blockhash value (it's always 32 bytes). This is correct.

**Evidence:** The test `9.13a` in the suite confirms that unsigned serialization reserves signature bytes.

**Fix:** None needed.

### Finding W6 (LOW): The `planRedemption` function's `rateLimit` calculation.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The `rateLimit` function computes the cap from live supply and checks the k-th most recent redemption. This mirrors BURN's logic. The `nextAt` is `kth + win`, which is when the k-th most recent redemption is a full window old. This is correct.

**Evidence:** The test `rate limit: three openings in the last minute block a fourth until the oldest is an hour old` passes.

**Fix:** None needed.

### Finding W7 (INFO): The `planRedemption` function's `owedSats` calculation.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The `owedSats` function computes `weight * acc + carry - debt` and floors to whole sats. This mirrors MINT's `owed_of`. The test verifies this against the program's logic.

**Evidence:** The test `owedSats == MINT owed_of` passes.

**Fix:** None needed.

### Finding W8 (LOW): The `planRedemption` function's handling of a vault with a boost.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The `owedSats` function includes `record.boost_weight` in the weight. This is correct — a boosted vault has a higher weight.

**Evidence:** The test `owedSats of a boosted level V (6 + 3) at acc 5e12` passes.

**Fix:** None needed.

### Finding W9 (INFO): The `planRedemption` function's handling of a vault with a pending activation and a boost.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** A pending vault can't have a boost (`boost_vault` requires `r.active`). So this case can't arise.

**Evidence:** The program code confirms this.

**Fix:** None needed.

### Finding W10 (LOW): The `planRedemption` function's handling of a vault with a retired record.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** A retired record causes a refusal. This is correct — a retired vault is already burned.

**Evidence:** The test `retired record: refused` passes.

**Fix:** None needed.

### Finding W11 (INFO): The `planRedemption` function's handling of a vault with no asset info.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If `s.assetInfo` is null or burned, the plan refuses. This is correct.

**Evidence:** The test `already burned: refused` passes.

**Fix:** None needed.

### Finding W12 (LOW): The `planRedemption` function's handling of a vault not in the CBOB collection.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If the asset's collection doesn't match `ids.COLL`, the plan refuses. This is correct.

**Evidence:** The test `not our collection: refused` passes.

**Fix:** None needed.

### Finding W13 (INFO): The `planRedemption` function's handling of a vault not owned by the connected wallet.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If the asset's owner doesn't match the connected wallet, the plan refuses. This is correct.

**Evidence:** The test `not the owner: refused` passes.

**Fix:** None needed.

### Finding W14 (LOW): The `planRedemption` function's handling of a vault with an unreadable asset.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If the asset can't be parsed, `readVault` throws. The page catches this and shows an error. This is correct.

**Evidence:** The `readVault` function throws on unparseable assets.

**Fix:** None needed.

### Finding W15 (INFO): The `planRedemption` function's handling of a vault with plugins that can't be read.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** If the asset's plugins can't be read, `parseCoreAsset` sets `pluginsUnreadable: true`. The plan doesn't check this flag. But the asset's owner and collection are still read correctly. The seal state might be unknown, but the plan doesn't need it (the programs check the seal).

**Evidence:** The `parseCoreAsset` function handles unreadable plugins gracefully.

**Fix:** None needed.

### Finding W16 (LOW): The `planRedemption` function's handling of a vault with an unknown plugin type.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The `parseCoreAsset` function lists unknown plugins by number. The plan doesn't check for unknown plugins. But the programs don't care about unknown plugins either (they only check the seal and the owner).

**Evidence:** The test `an asset carrying plugin type 18 is READ, not refused` passes.

**Fix:** None needed.

### Finding W17 (INFO): The `planRedemption` function's handling of a vault with a Groups plugin.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The Groups plugin (type 18) is listed but not parsed. The plan doesn't check for it. The programs don't care about it either.

**Evidence:** The test `the Groups-plugin NFT really parses` passes.

**Fix:** None needed.

### Finding W18 (LOW): The `planRedemption` function's handling of a vault with an Autograph plugin.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The Autograph plugin (type 14) is listed but not parsed. The plan doesn't check for it. The programs don't care about it either. But a large Autograph can exhaust Core's heap (documented in SPEC item 40).

**Evidence:** The suite tests this (R28.A1-A4).

**Fix:** None needed.

### Finding W19 (INFO): The `planRedemption` function's handling of a vault with a PermanentTransferDelegate.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The PermanentTransferDelegate (type 7) is listed. The plan doesn't check for it. The programs don't care about it either (it only affects transfers, not redemptions).

**Evidence:** The suite tests this (R35.N8, R35.N8a).

**Fix:** None needed.

### Finding W20 (LOW): The `planRedemption` function's handling of a vault with a PermanentFreezeExecute that's thawed.

**Where:** `web/src/lib/plan-redeem.mjs`

**What:** The plan doesn't check the seal state. If the seal is thawed (which shouldn't happen outside a redemption), the plan would still build the redemption. The programs would accept it (SEAL's open would thaw an already-thawed vault, which is a no-op). This is not a security issue.

**Evidence:** The programs handle this correctly.

**Fix:** None needed.

---

## The Ceremony: New Findings

### Finding C1 (LOW): The ceremony's `preflight` function doesn't check that the programs are not already initialized.

**Where:** `web/src/pages/ceremony.mjs`

**What:** The `preflight` function checks the program bytes and probes, but doesn't check if the configs are already initialized. The `steps` function checks each step's state and skips done steps. But if a config is initialized with wrong values, the step shows "WRONG ON CHAIN: STOP". This is correct.

**Evidence:** The test `a second SEAL initialize is refused` passes.

**Fix:** None needed.

### Finding C2 (LOW): The ceremony's `steps` function re-reads the step before signing.

**Where:** `web/src/pages/ceremony.mjs`

**What:** Before signing, the step is re-read. If the state changed (e.g., the step already landed), the ceremony re-runs `steps`. This prevents double-sends.

**Evidence:** The test `a step that landed after a time-out is never sent twice` passes (in the e2e test).

**Fix:** None needed.

### Finding C3 (INFO): The ceremony's `steps` function remembers the collection address before signing step 0.

**Where:** `web/src/pages/ceremony.mjs`

**What:** The collection address is stored in `localStorage` before step 0 is signed. This prevents a reload from offering to create a second collection.

**Evidence:** The test `M2: the page remembers the new address BEFORE step 0 is signed` passes.

**Fix:** None needed.

### Finding C4 (LOW): The ceremony's `resolveCollection` function scans the chain for existing collections.

**Where:** `web/src/lib/ceremony-reads.mjs`

**What:** The `resolveCollection` function lists Core collections whose update authority is MINT's PDA. If more than one exists, it stops. This prevents creating a second collection.

**Evidence:** The test `M2: two such collections on chain: STOP` passes.

**Fix:** None needed.

### Finding C5 (INFO): The ceremony's `launchWithCollection` function substitutes the collection into the launch values.

**Where:** `web/src/lib/plan-ceremony.mjs`

**What:** The `launchWithCollection` function creates a copy of the launch JSON with `vault_collection` set to the ceremony's collection. This allows `judgeLaunch` to pass before the collection is recorded in the launch file.

**Evidence:** The test `launchWithCollection changes ONLY vault_collection` passes.

**Fix:** None needed.

### Finding C6 (LOW): The ceremony's `judgeProgramBytes` function checks the prefix hash and zero tail.

**Where:** `web/src/lib/plan-ceremony.mjs`

**What:** The `judgeProgramBytes` function hashes the first `len` bytes of the deployed program and checks they match the audited sha256. It also checks that every byte after `len` is zero. This is the SPEC road step 9 check.

**Evidence:** The test `program bytes: the dist/ build followed by zero padding passes` passes.

**Fix:** None needed.

### Finding C7 (INFO): The ceremony's `judgeProbe` function distinguishes the placeholder from the real program.

**Where:** `web/src/lib/plan-ceremony.mjs`

**What:** The `judgeProbe` function simulates a probe instruction. The placeholder answers `Custom(0)` with a "CBOB placeholder" log. The real program answers `InstructionFallbackNotFound` (101) for Anchor programs or `InvalidInstructionData` for the sweep helper.

**Evidence:** The test `probe: the placeholder is caught` passes.

**Fix:** None needed.

### Finding C8 (LOW): The ceremony's `steps` function doesn't check the upgrade authority state.

**Where:** `web/src/pages/ceremony.mjs`

**What:** The `preflight` function shows the upgrade authority but doesn't refuse if it's still set. The ceremony can run before the upgrade authority is removed (road step 9 vs 11). This is correct — the upgrade authority is removed in step 11, after the ceremony.

**Evidence:** The SPEC road steps confirm this ordering.

**Fix:** None needed.

### Finding C9 (INFO): The ceremony's `steps` function doesn't check the lock deadline.

**Where:** `web/src/pages/ceremony.mjs`

**What:** The `judgeLaunch` function checks the lock deadline. If it's OPEN, the ceremony refuses. This is correct — the lock deadline must be set before the ceremony.

**Evidence:** The test `TODAY: judgeLaunch refuses the committed launch/mainnet-init.json` passes.

**Fix:** None needed.

### Finding C10 (LOW): The ceremony's `steps` function doesn't check the charter opening date.

**Where:** `web/src/pages/ceremony.mjs`

**What:** The `judgeLaunch` function checks the charter opening date. If it's OPEN, the ceremony refuses. This is correct.

**Evidence:** The test `TODAY: judgeLaunch refuses the committed launch/mainnet-init.json` passes.

**Fix:** None needed.

---

## The RPC Proxy: New Findings

### Finding P1 (LOW): The proxy's `gpaShape` function doesn't validate the `dataSlice` length field.

**Where:** `web/deploy/rpc-proxy.mjs`

**What:** The `gpaShape` function checks `ds.offset === 0 && ds.length === 0` for Core queries. But it doesn't check that `dataSlice` is absent for MINT queries. The MINT query has `ds === undefined`. This is correct.

**Evidence:** The test `MINT with any other value at 177` is refused.

**Fix:** None needed.

### Finding P2 (INFO): The proxy's `txRefusal` function checks the transaction size.

**Where:** `web/deploy/rpc-proxy.mjs`

**What:** The `txRefusal` function checks `raw.length <= 1232`. This is the legacy packet limit. v0 transactions can be larger (up to 1,232 bytes for legacy, but v0 can be larger with a lookup table). The proxy refuses transactions larger than 1,232 bytes. This is correct for the pages' use case (they build legacy transactions).

**Evidence:** The test `a page transaction (open + burn) is accepted` passes.

**Fix:** None needed.

### Finding P3 (LOW): The proxy's `txRefusal` function doesn't check the transaction version.

**Where:** `web/deploy/rpc-proxy.mjs`

**What:** The `txRefusal` function deserializes the transaction with `VersionedTransaction.deserialize`. It doesn't check the version. A v0 transaction with a lookup table would be accepted if it's under 1,232 bytes and calls only allowed programs. This is fine — the pages build legacy transactions, but a v0 transaction is also valid.

**Evidence:** The test `a prior transaction (ATA creates) is accepted` passes.

**Fix:** None needed.

### Finding P4 (INFO): The proxy's `handler` function checks the Origin header.

**Where:** `web/deploy/rpc-proxy.mjs`

**What:** The `handler` function refuses requests without an Origin header or with a different Origin. This is the M1 fix from REVIEW-web.md.

**Evidence:** The test `a request with NO Origin is refused` passes.

**Fix:** None needed.

### Finding P5 (LOW): The proxy's `handler` function checks `Sec-Fetch-Site`.

**Where:** `web/deploy/rpc-proxy.mjs`

**What:** The `handler` function refuses requests with `Sec-Fetch-Site` other than `same-origin`. This is defense in depth.

**Evidence:** The test `a cross-site fetch is refused` passes.

**Fix:** None needed.

### Finding P6 (INFO): The proxy's `handler` function caps the response while streaming.

**Where:** `web/deploy/rpc-proxy.mjs`

**What:** The `readCapped` function reads the response stream and aborts if it exceeds the cap. This is the M1 fix from REVIEW-web.md.

**Evidence:** The test `the response cap stops the read WHILE it streams` passes.

**Fix:** None needed.

### Finding P7 (LOW): The proxy's `handler` function keys IPv6 rate limits by /64.

**Where:** `web/deploy/rpc-proxy.mjs`

**What:** The `ipKey` function extracts the /64 prefix from IPv6 addresses. This is the M1 fix from REVIEW-web.md.

**Evidence:** The test `IPv6 rate limits are keyed by /64` passes.

**Fix:** None needed.

### Finding P8 (INFO): The proxy's `handler` function refuses to start without a collection.

**Where:** `web/deploy/rpc-proxy.mjs`

**What:** The `handler` function throws if `requireCollection` is true and `collection` is not a valid address. This is the M1 fix from REVIEW-web.md.

**Evidence:** The test `the public proxy will not start without CBOB_VAULT_COLLECTION` passes.

**Fix:** None needed.

### Finding P9 (LOW): The proxy's `handler` function doesn't check the `CBOB_RPC_ORIGIN` against the request's Host header.

**Where:** `web/deploy/rpc-proxy.mjs`

**What:** The `handler` function checks the Origin header against the configured origin. But it doesn't check the Host header. A request with the correct Origin but a different Host would be accepted. This is not a security issue — the Origin is what matters for CORS.

**Evidence:** The test `an allowed call from the site is forwarded` passes.

**Fix:** None needed.

### Finding P10 (INFO): The proxy's `handler` function doesn't check the `X-Real-IP` header's trustworthiness.

**Where:** `web/deploy/rpc-proxy.mjs`

**What:** The `handler` function trusts `X-Real-IP` only from loopback. The nginx config sets `X-Real-IP` from `$remote_addr`. This is correct.

**Evidence:** The nginx config confirms this.

**Fix:** None needed.

---

## The Metadata Generator: New Findings

### Finding M1 (LOW): The metadata generator's `generate` function doesn't handle a vault whose record is unreadable.

**Where:** `web/meta/generate.mjs`

**What:** If a vault record can't be decoded, the vault is added to `kept` with "its record could not be read". The previous file is kept. This is correct.

**Evidence:** The test `a vault whose record cannot be read KEEPS its previous file` passes.

**Fix:** None needed.

### Finding M2 (INFO): The metadata generator's `generate` function doesn't handle a vault whose NFT is unreadable.

**Where:** `web/meta/generate.mjs`

**What:** If the NFT can't be parsed, the vault is added to `kept`. The previous file is kept. This is correct.

**Evidence:** The test `a vault whose NFT cannot be read KEEPS its previous file` passes.

**Fix:** None needed.

### Finding M3 (LOW): The metadata generator's `generate` function doesn't handle a vault whose cbBTC account is unreadable.

**Where:** `web/meta/generate.mjs`

**What:** If the cbBTC account can't be parsed, the vault is added to `kept`. The previous file is kept. This is correct.

**Evidence:** The test `a vault whose cbBTC account cannot be read KEEPS its previous file` passes.

**Fix:** None needed.

### Finding M4 (INFO): The metadata generator's `generate` function checks the slot for monotonicity.

**Where:** `web/meta/generate.mjs`

**What:** The `generate` function checks that the read slot is not older than the previous file's slot. If it is, the vault is kept. This prevents lagging reads from overwriting good files.

**Evidence:** The test `L4: a read answered at an OLDER slot than the file's keeps the file` passes.

**Fix:** None needed.

### Finding M5 (LOW): The metadata generator's `generate` function checks for level regression.

**Where:** `web/meta/generate.mjs`

**What:** If a vault's level reads as undrawn after it was drawn, the vault is kept. This prevents lagging reads from undrawing levels.

**Evidence:** The test `L4: a level reading as undrawn after it was drawn keeps the file` passes.

**Fix:** None needed.

### Finding M6 (INFO): The metadata generator's `generate` function checks for gone-vault regression.

**Where:** `web/meta/generate.mjs`

**What:** If a vault reads as existing after it was gone, the vault is kept. This prevents lagging reads from resurrecting burned vaults.

**Evidence:** The test `L4: a vault reading as existing after it was gone keeps the file` passes.

**Fix:** None needed.

### Finding M7 (LOW): The metadata generator's `generate` function checks the pictures before use.

**Where:** `web/meta/generate.mjs`

**What:** The `imageOk` function checks that each picture answers 200 with an image content type. If a picture is down, the vault is kept. This prevents broken images.

**Evidence:** The test `the Level III picture is down: that vault keeps its previous file` passes.

**Fix:** None needed.

### Finding M8 (INFO): The metadata generator's `generate` function writes atomically.

**Where:** `web/meta/generate.mjs`

**What:** The `writeIfChanged` function writes to a temp file and renames. This prevents partial writes.

**Evidence:** The code confirms this.

**Fix:** None needed.

### Finding M9 (LOW): The metadata generator's `generate` function doesn't delete files for vaults that no longer exist.

**Where:** `web/meta/generate.mjs`

**What:** The `generate` function writes files for all vault records. If a vault is burned, its record still exists (records are never closed). The file is updated to say "Gone". Files are never deleted. This is correct.

**Evidence:** The test `a vault that no longer exists: Activated "Gone"` passes.

**Fix:** None needed.

### Finding M10 (INFO): The metadata generator's `generate` function doesn't handle a vault outside the collection.

**Where:** `web/meta/generate.mjs`

**What:** If a vault's NFT is not in the CBOB collection, the vault is kept with "its NFT is not in the vault collection". This is correct.

**Evidence:** The test `the vault outside the collection kept` passes.

**Fix:** None needed.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

### What should this project do before launch that AI audit structurally cannot?

1. **Run the e2e-localnet test.** The web/ pages' end-to-end test (`web/test/e2e-localnet.sh`) has not been run. It exercises the ceremony, claims, draws, activation, rescue, and redemption against real programs on a local validator. This is the closest thing to a dress rehearsal for the holder pages. Run it and fix any failures.

2. **Run the dress rehearsal at throwaway IDs.** SPEC item 53 requires a full rehearsal at throwaway program IDs. The rehearsal tree script exists, but the rehearsal value set (`launch/rehearsal-init.json`) is not written. Write it and run the full rehearsal.

3. **Run one full live revenue cycle through both pools.** SPEC item 22 requires this. The swap fork test (`sim/swap-fork.sh`) exercises the swap against cloned mainnet state, but the full revenue cycle (sweep, swap, return, split, ledger) has never run end-to-end.

4. **Run one forced post-sweep failure and walk through the hand recovery.** SPEC item 22 requires this. The hand recovery path has never been exercised.

5. **Verify the deployed bytes on mainnet.** The five program IDs are claimed with placeholders. The upgrade to the real bytes has not happened. After the upgrade, verify the prefix hash and zero tail for each program.

6. **Create the vault collection and record its address.** Road step 10 creates the collection. The address must be recorded in `web/src/config.js` and `launch/mainnet-init.json` before the ceremony can proceed.

7. **Set the charter opening date and lock deadline.** These are the last OPEN values. Without them, the launch checker refuses to pass.

8. **Publish the holder pages and enable the RPC proxy.** The pages are staged but not published. The RPC proxy is staged but not installed. The metadata generator is not installed as a cron job.

9. **Publish the holder guide.** The holder guide is marked DRAFT and may not be published before item 50 ships.

10. **Remove the upgrade authority from all five programs.** This is the final step. After this, nothing can be fixed.

11. **Consider a human review of the web/ pages' transaction builders.** The AI audit has verified the builders byte-for-byte against the suite's builders, but a human review of the page logic (especially the redemption plan's edge cases) would catch issues that AI might miss.

12. **Consider a human review of the ceremony's step ordering.** The ceremony signs immutable values. A human review of the step ordering and the re-read logic would catch issues that AI might miss.

13. **Consider a human review of the RPC proxy's allowlist.** The proxy's method and filter allowlist is security-critical. A human review would catch issues that AI might miss.

14. **Consider a human review of the metadata generator's fail-closed logic.** The generator writes public metadata. A human review would catch issues that AI might miss.

15. **Document the operational runbooks.** The rescue return process (Squads returns vaults to senders), the hand recovery for revenue cycles, and the ceremony's local mode all need written runbooks that a human operator can follow.

16. **Test the alarm's response to a real incident.** The alarm has never seen a real incident. A tabletop exercise (simulated guardian stop, simulated sweep without return, simulated frozen pool) would verify that the alarm pages correctly and that the runbooks work.

17. **Test the crank's behavior with 2,100 vaults.** The crank has never run against a live chain with 2,100 vaults. The dress rehearsal should include a full crank pass with a realistic number of vaults.

18. **Test the redemption poster's behavior.** The poster drafts posts but has no sender. The X/Twitter posting needs Gary's go-ahead and a website surface. Test the full posting flow before launch.

19. **Test the metadata generator's behavior with a realistic number of vaults.** The generator has never run against a live chain with 2,100 vaults. Test it with a realistic number of vaults.

20. **Verify the backup of the deploy authority key.** The placeholder upgrade key (`bank/keys/deploy-authority.json`) must be in the nightly backup. Verify this before the upgrade.

21. **Verify the backup of the swap operator key and the $CBOB release key.** These keys are critical. Verify they're in the backup.

22. **Test the guardian's stop and restart flow.** The guardian can stop sales and sweep. A vote can restart them. Test this flow end-to-end before launch.

23. **Test the swap operator replacement flow.** A vote can arm a new swap operator, and after notice, anyone can apply it. Test this flow end-to-end before launch.

24. **Test the guardian replacement flow.** A vote can arm a new guardian, and after notice, anyone can apply it. Test this flow end-to-end before launch.

25. **Test the boost flow with real $CBOB.** The boost has been tested with a local $CBOB mint. Test it with the real $CBOB mint on mainnet (after the release wallet releases some).

26. **Test the charter claim with a real Proof of Burn.** The simulation uses cloned Proof of Burn accounts. Test the claim with a real Proof of Burn on mainnet (during the charter window).

27. **Test the buy flow with real cbBTC.** The buy page has been tested with mock RPC. Test it with real cbBTC on mainnet (during a sale round).

28. **Test the redeem flow with real cbBTC, $GARY, and $GIRAFFISH.** The simulation uses cloned mint accounts. Test the redemption with real tokens on mainnet.

29. **Test the rescue flow with a real nested vault.** The rescue has been tested on a local validator. Test it on mainnet with a real nested vault.

30. **Test the metadata generator's output against the actual site.** The generator writes JSON files. Verify they're served correctly by the site.

31. **Test the RPC proxy's rate limits under load.** The proxy has rate limits. Test them under realistic load.

32. **Test the alarm's behavior with a real incident.** The alarm has never seen a real incident. A tabletop exercise would verify the runbooks.

33. **Test the crank's behavior with a transient RPC error.** The crank has retry logic. Test it with a transient RPC error.

34. **Test the revenue job's behavior with a transient RPC error.** The revenue job has retry logic. Test it with a transient RPC error.

35. **Test the alarm's behavior with a transient RPC error.** The alarm has retry logic. Test it with a transient RPC error.

36. **Test the poster's behavior with a transient RPC error.** The poster has retry logic. Test it with a transient RPC error.

37. **Test the metadata generator's behavior with a transient RPC error.** The generator has retry logic. Test it with a transient RPC error.

38. **Test the ceremony's behavior with a transient RPC error.** The ceremony has retry logic. Test it with a transient RPC error.

39. **Test the pages' behavior with a transient RPC error.** The pages have retry logic. Test them with a transient RPC error.

40. **Test the pages' behavior with a rate-limited RPC.** The pages use the proxy, which has rate limits. Test them with a rate-limited RPC.

41. **Test the pages' behavior with a slow RPC.** The pages have timeouts. Test them with a slow RPC.

42. **Test the pages' behavior with a malicious RPC.** The pages validate RPC responses. Test them with a malicious RPC.

43. **Test the pages' behavior with a malicious wallet.** The pages validate wallet signatures. Test them with a malicious wallet.

44. **Test the pages' behavior with a malicious transaction.** The pages validate transactions. Test them with a malicious transaction.

45. **Test the pages' behavior with a malicious vault.** The pages validate vault state. Test them with a malicious vault.

46. **Test the pages' behavior with a malicious Proof of Burn.** The pages validate Proof of Burn state. Test them with a malicious Proof of Burn.

47. **Test the pages' behavior with a malicious collection.** The pages validate collection state. Test them with a malicious collection.

48. **Test the pages' behavior with a malicious program.** The pages validate program state. Test them with a malicious program.

49. **Test the pages' behavior with a malicious RPC proxy.** The pages use the proxy. Test them with a malicious proxy.

50. **Test the pages' behavior with a malicious metadata generator.** The pages read metadata. Test them with a malicious generator.

These are the things that AI audit structurally cannot do: run the actual deployment, test against real mainnet state, and verify the operational runbooks. The AI audit has verified the code logic, but the operational reality (real RPCs, real wallets, real tokens, real incidents) can only be tested by running the system.