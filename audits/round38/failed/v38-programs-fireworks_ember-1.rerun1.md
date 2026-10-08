[reasoning only]
This is a massive audit task. Let me think about how to approach it.

The task: audit five Solana programs (SEAL, MINT, BURN, GOV, SWEEP) plus the off-chain pipeline and web/ holder pages. Round 37's verdict is bundled: NOT CLEAN, 3 findings (V1, V2, V3), all in web/, all repaired per VALIDATION.md. My job: independently verify repairs, find surviving defects.

Let me focus on the highest-value targets. The programs are the immutable core. Let me read them carefully for real bugs.

Let me start with the programs, since those are permanent.

**MINT program analysis:**

Key areas: the pool accumulator, two-step activation, boosts, the level draw, charter claim, monthly_inline.

Let me look at `claim` carefully:

```rust
for pair in pairs.chunks(2) {
    let (ri, dest) = (&pair[0], &pair[1]);
    require!(ri.is_writable, MintError::BadVaultRecord);
    let mut r = load_record(ri)?;
    if r.pending {
        require_keys_eq!(dest.key(), r.vault_ata, MintError::WrongVaultAccount);
        if ctx.accounts.config.dist_epoch > r.request_epoch {
            join(&mut ctx.accounts.config, &mut r)?;
            store_record(ri, &r)?;
            n_joined += 1;
        }
        continue;
    }
    if !r.active { continue; }
    ...
```

Wait — `load_record` loads a VaultRecord from any account owned by MINT with the right discriminator/version. But it does NOT verify the account is the PDA `["vault", r.asset]`! Let me check `load_record`:

```rust
fn load_record(a: &AccountInfo) -> Result<VaultRecord> {
    require_keys_eq!(*a.owner, crate::ID, MintError::BadVaultRecord);
    let d = a.try_borrow_data()?;
    let r = VaultRecord::try_deserialize(&mut &d[..]).map_err(|_| error!(MintError::BadVaultRecord))?;
    require!(r.version == VAULT_RECORD_VERSION, MintError::BadVaultRecord);
    Ok(r)
}
```

So in `claim`, the record account is not verified to be the PDA of the asset it names. But wait — records are only created by `mint_vault`/`claim_charter_vault` via `#[account(init, seeds=[VAULT_SEED, asset])]`, so only one record per asset can exist, and only MINT can write records. So a record's contents are authentic; the PDA check matters for... hmm, actually since only MINT creates them at the derived address, any account owned by MINT that deserializes as a VaultRecord IS a genuine record. The `asset` field inside is authentic. So no issue there — the claim pays to `r.vault_ata` which was recorded at activation. OK.

But wait — in `claim`, for the pending join path: `require_keys_eq!(dest.key(), r.vault_ata, ...)`. For a pending record, `vault_ata` was set at request time. Fine.

What about `expire_boosts`: `load_record(ri)` — same, records are authentic. It expires boosts on any record. Fine.

**The `activate` second call (join):**

```rust
if r.pending {
    require_keys_eq!(ctx.accounts.asset.key(), r.asset, MintError::WrongAsset);
    require_live_vault(&ctx.accounts.asset, &collection)?;
    require!(ctx.accounts.config.dist_epoch > r.request_epoch, MintError::ActivationPending);
    let (c, r) = (&mut ctx.accounts.config, &mut ctx.accounts.vault_record);
    return join(c, r);
}
```

Note: the join via `activate` requires the live vault check, but the join via `claim` does NOT (claim only has record + dest accounts, no asset account). Round 27 / red-team 3 finding 2 accepted: a bare-burned vault still waiting can be joined by a claim naming it (dead weight). That's accepted limit 27. OK.

**`retire` function:**

```rust
fn retire(c: &mut MintConfig, r: &mut VaultRecord, redeemed: bool, forfeit: bool) -> Result<()> {
    require!(!r.retired, MintError::AlreadyRetired);
    ...
    if r.active {
        let w = weight_of(r)?;
        let full = (w as u128).checked_mul(c.acc_scaled)...;
        let pending = owed_of(r, c.acc_scaled)?;
        if redeemed && !forfeit { require!(pending < ACC_SCALE, MintError::ClaimBeforeBurn); }
        ...
        c.owed_scaled = c.owed_scaled.checked_sub(pending)...;
        c.total_active_weight = c.total_active_weight.checked_sub(w)...;
        c.active_count...;
        if r.boost_weight > 0 { unschedule_boost(c, r)?; }
        r.debt_scaled = full;
        r.carry_scaled = 0;
        r.active = false;
        returned = pending;
    }
    if r.pending { ... }
    r.retired = true;
    ...
}
```

Looks consistent.

**`owed_of`:**

```rust
fn owed_of(r: &VaultRecord, acc: u128) -> Result<u128> {
    (weight_of(r)? as u128).checked_mul(acc)?
        .checked_add(r.carry_scaled)?
        .checked_sub(r.debt_scaled).ok_or(error!(MintError::Overflow))
}
```

weight*acc + carry - debt. After a claim: `carry = pending - settled`, `debt = weight*acc`. So owed after claim = weight*acc + (pending - pay*SCALE) - weight*acc = pending - pay*SCALE = sub-sat remainder. Good.

After reweigh (boost): carry = owed (full pending), debt = new_weight * acc. owed = new_weight*acc + owed - new_weight*acc = owed. Good.

After expire_boost: reweigh(c, r, 0): carry = owed at boosted weight, debt = base*acc. owed = base*acc + owed - base*acc = owed. Good.

**`credit`:**

```rust
fn credit(c: &mut MintConfig, avail: u64, w: u64, now: i64) -> Result<()> {
    let delta = (avail as u128).checked_mul(ACC_SCALE)? / (w as u128);
    c.acc_scaled = c.acc_scaled.checked_add(delta)?;
    c.owed_scaled = c.owed_scaled.checked_add(delta.checked_mul(w as u128)?)?;
    c.last_distribute_at = now;
    advance_epoch(c)
}
```

delta*w <= avail*SCALE, so owed grows by at most avail (in sats, rounded down). Pool holds balance; avail = balance - ceil(owed). After credit, owed' = owed + delta*w; ceil(owed') <= ceil(owed) + avail <= balance. Invariant holds.

**`monthly_inline`:** checks pool key, due, boosts_due==0, waiting_to_join==0, total_active_weight>0, pool is SPL token, not frozen, balance, avail>0, then credit. Note it uses `balance.saturating_sub(ceil_sats(c.owed_scaled))` — saturating, so if pool < owed it credits 0 rather than refusing. Hmm, that means if pool is short (shouldn't happen), monthly_inline silently does nothing. Fine.

Wait — there's a subtle issue: `monthly_inline` when `total_active_weight == 0` and `pending_this_epoch > 0` calls `tick(c, now)` which advances epoch. But what if `total_active_weight == 0` and `pending_this_epoch == 0` but `pending_count > 0` (waiting from earlier epochs)? Then `waiting_to_join(c) > 0` and it returns early (logs MONTHLY_WAITS_FOR_JOINS). OK that's handled above.

Actually wait, order: `if c.boosts_due > 0` return; `if waiting_to_join(c)? > 0` return; `if c.total_active_weight == 0 { if c.pending_this_epoch > 0 { tick }; return }`. So tick only when nobody is waiting from earlier epochs and someone requested this epoch. Good.

**`distribute`:** 

```rust
let (balance, _) = read_token(&ctx.accounts.pool_token, &ctx.accounts.config.payment_mint, &pool_owner)?;
require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst);
let w = ctx.accounts.config.total_active_weight;
if w == 0 {
    require!(waiting_to_join(c)? == 0, MintError::JoinWaitingFirst);
    require!(!burn && c.pending_this_epoch > 0, MintError::NoActiveVaults);
    require!(ctx.remaining_accounts.is_empty(), MintError::BadBurnAccounts);
    require!(now >= c.last_distribute_at + c.monthly_secs, MonthNotElapsed);
    return tick(c, now);
}
let owed = ceil_sats(ctx.accounts.config.owed_scaled);
let avail = balance.checked_sub(owed).ok_or(MintError::PoolShort)?;
require!(avail > 0, MintError::NothingToDistribute);
if burn { ... } else { ... }
credit(c, avail, w, now)
```

Note: `distribute` reads the pool via `read_token` which requires owner==SPL_TOKEN_ID, len==165, mint and owner match. If pool frozen: read_token returns state; distribute doesn't check state! A frozen pool: `read_token` succeeds (state=2), and distribute would credit from a frozen pool. Round 24 D4 / red-team 3: "an explicit `distribute` still can [credit from a frozen pool], and our crank does not send one while the pool is frozen". That's stated in DESIGN-v6 RT3 section: "an explicit `distribute` still can, and our crank does not send one while the pool is frozen". So it's known/stated. Crediting from a frozen pool makes vaults owed again; owed vaults redeem by forfeit. Not a loss of funds. OK, stated.

**Boost ring logic:**

`boost_vault`: end = dist_epoch + epochs; i = end % 64; boost_expiring[i]++. Note: epochs <= max_boost_epochs <= 63 (MAX_BOOST_EPOCHS_BOUND = 63). So end is at most 63 epochs ahead, so no two live boosts share a ring slot... wait, the comment says "a boost may last at most BOOST_RING - 1 distributions, so two live end epochs never share a slot". With max 63 epochs, end-epoch mod 64 is unique per end-epoch among live boosts (since live boosts' ends span < 64 epochs). Good.

`advance_epoch`: dist_epoch++, pending_this_epoch=0, i = dist_epoch % 64, boosts_due += boost_expiring[i], boost_expiring[i]=0.

Hmm — `advance_epoch` adds `boost_expiring[i]` to `boosts_due` where i = NEW dist_epoch % 64. A boost with end_epoch == new dist_epoch is due (it earns until dist_epoch reaches end). expire_boost requires `c.dist_epoch >= r.boost_end_epoch`. So after advance_epoch to epoch E, boosts with end==E are due. They were scheduled at slot E%64. Correct.

But: what if a boost is scheduled at slot i, and before the epoch reaches it, the ring slot gets cleared by advance_epoch wrapping? With max 63 epochs, end - current < 64 always, so when advance_epoch reaches end, slot end%64 still holds the count. But what if TWO boosts have the same end epoch? Both counted in slot. Fine. What if a boost with end epoch E is scheduled, and then 64 epochs pass without... no, distributions advance epochs; the gate `BoostsExpireFirst` stops distributions when boosts_due>0. But `tick` also advances epoch (via advance_epoch) — tick is called from distribute (w==0 path) and monthly_inline. Can ticks run past a due boost? monthly_inline checks boosts_due>0 and returns. distribute w==0 path: `require!(waiting_to_join(c)? == 0)` then tick — but does it check boosts_due? Look:

```rust
let (balance, _) = read_token(...)?;
require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst);
let w = ctx.accounts.config.total_active_weight;
if w == 0 { ... tick ... }
```

boosts_due check is before the w==0 branch. Good. And monthly_inline checks boosts_due. So no epoch advance while a boost is due. But wait — can a boost be due while total_active_weight==0? A boost requires active vault. If the vault retires (redeemed/burned), unschedule_boost removes it from due or ring. So boosts_due>0 implies some active boosted vault exists... unless the vault is retired. retire() calls unschedule_boost if r.boost_weight>0. So due boosts always have live active vaults. OK.

Hmm, but here's a subtle one: `expire_boosts` skips records where `r.retired || !r.active || r.boost_weight == 0 || dist_epoch < boost_end_epoch`. And `claim` expires due boosts on claimed vaults. And the gate. Fine.

**`unschedule_boost`:**

```rust
if c.dist_epoch >= r.boost_end_epoch {
    c.boosts_due = c.boosts_due.checked_sub(1)?;
} else {
    let i = (r.boost_end_epoch % 64) as usize;
    c.boost_expiring[i] = c.boost_expiring[i].checked_sub(1)?;
}
c.boosts_active -= 1; c.boost_weight_total -= r.boost_weight;
```

Called from retire (any boost) and expire_boost (due). Looks right.

**Now the level draw.** `try_capture`: A = first produced slot in [reveal_slot, reveal_slot+64]; B = first produced in [(A/4+2)*4, +64]; C similarly. Window check: now <= reveal_slot+300 else Expired. The comment says C is at most ~3*(8+64) past reveal_slot... A <= reveal+64, B target <= (A/4+2)*4 <= A+8+... let me compute: (A/4+2)*4 <= A+11 (rounding), so B target <= reveal+64+11 = reveal+75, B <= reveal+75+64 = reveal+139. C target <= B+11, C <= B+75 <= reveal+214. All within 300. OK.

`blockhash_in_window`: parses sysvar, checks key, count<=512, buffer length, skips slots outside [want, want+64], picks smallest, refuses all-zero hash. Looks fine.

**`reveal_level`:** FIFO via revealed_total, draws from remaining census, writes attribute via Core. For burned vaults skips the write. Checks attrs hash. OK.

**Charter claim:** PoB checks: owner==MPL_CORE, data[0]==1 (AssetV1), owner bytes == signer, data[33]==2 (collection UA), collection == pob_collection. Merkle proof <= 16, root matches. Burn via Core with pass-through accounts (never signers). Then create_vault. Looks right.

One thing: `claim_charter_vault` passes `pob_extra` accounts to Core's burn. The metas: `if a.is_writable { AccountMeta::new } else { AccountMeta::new_readonly }` — preserves writability, never signer. OK.

**`create_vault`:** builds CreateV2 with 3 plugins: PermanentFreezeExecute (frozen, authority SEAL PDA), PermanentTransferDelegate (authority rescue PDA), Attributes (authority mint PDA). Data encoding: `data.push(1)` for "some plugins"? Let me look at the encoding:

```rust
let mut data: Vec<u8> = vec![IX_CREATE_V2, 0];
data.extend(name); data.extend(uri);
data.push(1);                    // Some(plugins)?
data.extend_from_slice(&3u32.to_le_bytes());  // 3 plugins
data.push(PLUGIN_PERMANENT_FREEZE_EXECUTE);
data.push(1); // frozen
data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend(seal_pda);
data.push(PLUGIN_PERMANENT_TRANSFER_DELEGATE);
data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend(rescue_pda);
data.push(PLUGIN_ATTRIBUTES);
data.extend(attributes.len() u32);
for a: push_attr
data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend(mint_authority);
data.push(1); data.extend(0u32);  // Some(external adapters), 0 of them
```

This is asserted against the SDK in the suite (R.7 etc. pin opcodes; the suite mints real vaults through it). Fine.

**Initialize (MINT):** checks cbob_mint is classic SPL initialized, != payment_mint, != GARY. Bounds on boosts. bank_treasury != default. notice bounds. sweep bounds. level caps non-zero, sum <= max_supply. charter window valid, not over. pob_root non-zero. monthly bounds. pob_collection != default. Collection checks: owner Core, key==CollectionV1(5), update authority == mint_pda, name/uri parsed, num_minted==0, current_size==0, length exact (no plugin header). SEAL wiring check + payment mint is a reserve. Then writes config, installs royalty via AddCollectionPluginV1 with authority None.

Wait, the collection check: `require!(d.len() == o + 8, ...)` after reading name, uri, then 8 bytes (num_minted + current_size). So it requires NO trailing bytes — no plugin header. Good.

Hmm, one thing: `d[0] == KEY_COLLECTION_V1` (5). And update authority at [1..33]. For CollectionV1, layout is key(1) | update_authority(32) | name | uri | num_minted(4) | current_size(4). Yes matches.

**`split_revenue`:** reads revenue_ata balance, computes bank_cut = total * (10000-8500)/10000 (floor), holders = total - bank_cut. Transfers via TransferChecked with revenue PDA signing. Checks: revenue key, mint==payment_mint, revenue_ata==ATA(revenue), holders_ata==pool_ata, bank_ata==ATA(bank_treasury). decimals passed as arg — used in TransferChecked; if wrong decimals, the token program refuses (decimals mismatch). OK.

**`sweep_sol_for_swap`:** checks !sweep_stopped, amount>0, operator==config.swap_operator (signer), amount<=cap, cooldown, revenue PDA, bal >= reserve+amount. Transfers SOL. Sets last_sweep_at. OK.

**Governed instructions:** `Governed` context has `config` with `has_one = governance` and `governance: Signer`. So the governance PDA must sign. Only GOV's execute_proposal signs via invoke_signed with ["gov"] seed. OK.

**GOV program:**

`create_proposal`: reads mint config (pinned), burn total, quorum_supply = minted - burned - bare_retired. Proposer must own a live vault in collection. now >= charter_closes_at. Duration bounds. Actions: non-empty, <=5, one per kind, guardian+operator never bundled. Per-action validation. Writes proposal with snapshots.

`cast_vote`: owner of asset signs, collection matches, voting open, not executed, vault index < snapshot. VoteRecord PDA ["vote", proposal, asset] init — double vote fails (account exists). 

`execute_proposal`: voting ended, not executed, within 7 days. Confirms governance PDA is MINT's governance. Quorum: cast >= ceil(snapshot * quorum_bps/10000), need>0. Threshold: yes*10000/cast >= threshold. Turnout: yes >= ceil(10% of snapshot). Key change: yes >= ceil(50% of snapshot). Then per-kind ordering with skips, CPIs into MINT.

Potential issue: `read_vault_index` reads the vault record's mint_index. A vault minted after the proposal has index >= snapshot → VaultTooNew. Good.

Hmm, what about a vault that is burned but its record persists — can it vote? `cast_vote` reads the asset's owner from the Core asset account via `read_core_asset`, which requires data[0]==KEY_ASSET_V1 (1) and len>=66. A burned asset is 1 byte key 0 → fails → can't vote. Good.

**BURN program:**

`burn_vault`: checks asset is Core AssetV1 in collection, owner matches signer. Then requires preceding open_for_redemption for same asset+owner (walks instructions 0..current). Rate limit: live = minted - burned_total - bare_retired; cap = ceil(live*210/10000), min 1, bounded by ring 64. kth most recent must be >= window old. Then reserve checks: for each reserve mint, both token programs' ATA derived, must be declared; if owned by token program and len>=165: owner==pda, no delegate (d[72..76]==0), delegated_amount==0 (d[121..129]), close authority none (d[129..133]), len==165 exactly, amount==0. Then remaining accounts: if Core-owned, must not be a live AssetV1 (d empty or d[0]!=1). If lamports==0 skip. If token-owned and len>=165 and owner==pda: len==165, no delegate/close, amount==0. Then Core BurnV1, then CPI retire_redeemed, then burned_total++.

Wait — the reserve loop: `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }` — so a declared reserve ATA that is NOT token-owned (e.g., doesn't exist, or is a system account) is SKIPPED. That's the "account doesn't exist" case: the ATA address is declared but the account doesn't exist (owner is System, 0 lamports... actually a non-existent account passed in a tx is... on Solana, you can pass any address; if it doesn't exist, it appears as a system-owned 0-lamport 0-data account). So a missing reserve ATA is skipped — correct, since nothing can be in it.

But what if the reserve ATA EXISTS with a balance? Then owner==SPL_TOKEN, len==165, checks apply, amount must be 0. Good.

Hmm, what about the reserve ATA under Token-2022 for a classic mint? probe-round5b F4.2: creating a T22 ATA for a classic mint is REJECTED by the ATA program. So it can never exist. Good.

**The rate limit ring:** `rate_head` starts 0, ring all zeros (time 0 = long ago). kth = ring[(head + 64 - k) % 64]. After each redemption: ring[head]=now, head=(head+1)%64. 

Let me verify: with cap k, we need the k-th most recent redemption to be >= window old. The most recent is ring[(head-1)%64] (last written). k-th most recent is ring[(head-k)%64] = ring[(head+64-k)%64]. Yes. Initially all zeros, so now - 0 >= window → allowed. After k redemptions in the window, the k-th most recent is recent → refused. Correct rolling window.

Edge: cap > 64 → k=64 (bounded). live > 3047 → cap>64 → stricter. Stated.

**SEAL open_for_redemption:** reads asset owner+collection, owner==signer, collection==config.collection, collection account matches. Then walks instructions AFTER current for a burn_vault with matching asset (idx 0) and owner (idx 2). Then set_frozen(false) via Core UpdatePluginV1 signed by seal PDA.

Note: the walk starts at current+1 and breaks at first Err (load_instruction_at_checked returns Err past the end). Fail-closed. Good.

**The sweep helper:** data must be [0]. accounts >= 4, (len-4) even. signer must sign. token==SPL, system==system. signer != dest. For each pair: read_token both (owner SPL, len 165), src_owner==signer, to_owner==dest && to_mint==src_mint. Transfer amount if >0, close src (rent to dest). Then transfer all signer lamports to dest.

Potential issues:
- Same source twice: first pair transfers+closes; second pair's read_token on closed account: owner is... after close, the account is zeroed lamports and data? CloseAccount sets lamports to 0 and... actually SPL CloseAccount zeroes the data? No — CloseAccount transfers lamports and sets data length to 0? Let me recall: CloseAccount "closes" by transferring lamports out and then the account is... In SPL Token, CloseAccount: transfers lamports to dest, then `account.data` is reset — actually it calls `delete_account` which sets data len to 0 and owner to System? Hmm. In spl-token, `CloseAccount` does: transfer all lamports, then `account_info.data.borrow_mut()` — it resizes to 0? The suite SR.12a pins: duplicate source refused with "Provided owner is not allowed" (the second read fails because owner changed to System Program after close? Actually after close, the account's owner is set to the system program? No...). 

Actually in spl-token's CloseAccount processor: it transfers lamports, then calls `delete_account` which does `account.data.borrow_mut().fill(0)`? No. Let me recall the actual code:

```rust
// spl-token processor.rs close_account
**source_account_info.lamports.borrow_mut() = 0;
source_account_info.data.borrow_mut().fill(0); // ? 
```

Hmm, I believe modern spl-token does: zero lamports, then `source_account_info.assign(&system_program::ID)` (set owner to system) and resize to 0? There's `delete_account` in solana-program... Actually `solana_program::account_info::AccountInfo` has no delete; spl-token implements close by zeroing lamports and assigning to system program and reallocating to 0? In spl-token 4.0/5.0 (program), close_account does:

```rust
// Delete the account by transferring lamports and marking it as a system account
```

I recall it sets owner to System and data to empty. The suite measured SR.12a: second read of the closed source fails with IllegalOwner ("Provided owner is not allowed") because owner is no longer SPL Token. That's measured, so fine.

- A source that's also the destination wallet's account? src_owner must == signer (vault PDA), to_owner must == dest. If src==dest account: src_owner==signer and to_owner==dest requires signer==dest, but signer.key==dest.key is refused earlier. So no.

- Destination appears twice: two sources, same dest account (same mint). Both transfer into it, both close. Fine.

- wSOL native source: read_token reads mint/owner/amount; native wSOL account has is_native set; transfer moves amount (the token amount), close returns lamports (including the native reserve) to dest. Fine — actually for native accounts, amount == lamports roughly. Transfer of `amount` works; close works. OK.

- Frozen source: transfer reverts (0x11). Measured SR.14.

- The lamport sweep: `system_instruction::transfer(signer, dest, lamports)` — all lamports. If dest is a non-system account (e.g., a token account), system transfer to an existing account with data is allowed (transfer to any account is fine; it just adds lamports). R27.S1 measured: crediting lamports to a token account works. If dest doesn't exist (0 lamports, not in tx?) — dest must be in the tx (accounts[1]); a non-existent account can be passed; transfer to it below rent-exempt... system transfer creating an account below rent exemption fails. SPEC item 50: "A lamports-only sweep needs a destination that exists". The canonical dest is the owner (pays fee, exists). OK.

- After the sweep, BURN checks asset_signer.lamports()==0. The sweep empties it. But could Core's ExecuteV1 leave lamports? The sweep reads signer.lamports() at execution and transfers all. Within the same transaction, nothing deposits after. BURN's check is in a later instruction of the same tx. Fine.

**Now the R1s(e) question:** "What remains if a vault's reserve ATA does NOT EXIST when the page builds the transaction: the sweep cannot name it (it refuses a non-token account), but anyone can create a classic ATA for any owner, permissionlessly, and deposit into it before the redemption lands. SPEC's REDEEMING step 1 says the page creates the missing reserve accounts in a PRIOR transaction. Is that sufficient, and is there any account a stranger can create for the vault that neither the sweep can name nor BURN will skip (a Token-2022 ATA for a classic mint, a non-ATA token account, a nested Core asset)?"

So: if a reserve ATA doesn't exist at page-build time, page creates it in prior tx. A stranger could create it (with dust) between page build and redemption — but then it exists, the sweep names it, transfers the dust to the owner, closes it. Fine. If the stranger creates it AFTER the prior tx but the page already plans to create it — createAtaIdempotent is idempotent, so no conflict. If the stranger deposits into it after creation, the sweep moves live balance. Fine.

Token-2022 ATA for a classic mint: cannot be created (ATA program refuses, F4.2 measured). Non-ATA token account owned by the vault PDA: a stranger can create a non-ATA classic token account with owner = vault PDA (createAccount + InitializeAccount3 with owner=PDA — wait, can they? InitializeAccount3 sets the owner field to any pubkey without signature. Yes, owner field is just data). So a stranger can create a non-ATA classic token account owned by the vault PDA with a balance. BURN: the reserve loop only checks the ATA addresses. The second loop over remaining accounts: only checks declared accounts. A non-ATA account not declared is invisible. If declared: owner==pda → must be len 165, no delegate/close, amount==0. So if it holds a balance and is declared, refused; if undeclared, destroyed (accepted limit 44). The sweep CAN name it (helper accepts any classic account owned by signer). So the page can sweep it. Covered by item 44/25 D7.

Nested Core asset: destroyed if undeclared (item 44), rescued if it's a CBOB vault (item 58). Accepted.

**Now R7: cross-program raw reads.** Let me recompute offsets.

SEAL Config: disc[0..8], version[8], collection[9..41], reserve_mints Vec<Pubkey> at 41 (u32 len at 41..45, then keys), bump after. MINT reads OFF_VERSION=8, OFF_COLLECTION=9, OFF_RESERVES=41. ✓.

MINT MintConfig layout. Let me compute offsets:
- disc 0..8
- version: u8 @ 8
- collection: Pubkey @ 9..41
- governance: Pubkey @ 41..73
- pool_ata: Pubkey @ 73..105
- round_id: u32 @ 105..109
- opens_at: i64 @ 109..117
- closes_at: i64 @ 117..125
- price: u64 @ 125..133
- cap: u32 @ 133..137
- minted_this_round: u32 @ 137..141
- minted_total: u64 @ 141..149
- max_supply: u64 @ 149..157
- bank_treasury: Pubkey @ 157..189
- split_bps: u16 @ 189..191
- sales_stopped: bool @ 191
- sweep_stopped: bool @ 192
- guardian: Pubkey @ 193..225
- swap_operator: Pubkey @ 225..257
- sol_reserve_lamports: u64 @ 257..265
- bump: u8 @ 265
- max_sweep_lamports: u64 @ 266..274
- sweep_cooldown_secs: i64 @ 274..282
- last_sweep_at: i64 @ 282..290
- level_caps: [u32;5] @ 290..310
- level_minted: [u32;5] @ 310..330
- revealed_total: u64 @ 330..338
- payment_mint: Pubkey @ 338..370
- pob_collection: Pubkey @ 370..402
- pob_root: [u8;32] @ 402..434
- charter_opens_at: i64 @ 434..442
- charter_closes_at: i64 @ 442..450
- charter_claimed: u32 @ 450..454
- bare_burns_retired: u64 @ 454..462
- total_active_weight: u64 @ 462..470
- active_count: u64 @ 470..478
- acc_scaled: u128 @ 478..494
- owed_scaled: u128 @ 494..510
- last_distribute_at: i64 @ 510..518
- sales_stopped_at: i64 @ 518..526
- sweep_stopped_at: i64 @ 526..534
- pending_swap_operator: Pubkey @ 534..566
- pending_swap_operator_at: i64 @ 566..574
- monthly_secs: i64 @ 574..582
- pending_guardian: Pubkey @ 582..614
- pending_guardian_set: bool @ 614
- pending_guardian_at: i64 @ 615..623
- notice_secs: i64 @ 623..631
- sweep_floor_lamports: u64 @ 631..639
- cooldown_ceiling_secs: i64 @ 639..647
- reserve_ceiling_lamports: u64 @ 647..655
- dist_epoch: u64 @ 655..663
- pending_count: u64 @ 663..671
- pending_this_epoch: u64 @ 671..679
- cbob_mint: Pubkey @ 679..711
- max_boost_weight: u8 @ 711
- max_boost_epochs: u16 @ 712..714
- boost_price: u64 @ 714..722
- boost_weight: u8 @ 722
- boost_epochs: u16 @ 723..725
- boosts_active: u32 @ 725..729
- boosts_due: u32 @ 729..733
- boost_weight_total: u64 @ 733..741
- cbob_burned_total: u64 @ 741..749
- boost_expiring: [u32;64] @ 749..1005
- CONFIG_PADDING 256 @ 1005..1261

GOV reads: OFF_MINT_VERSION=8 ✓, OFF_MINT_COLLECTION=9 ✓, OFF_MINT_GOVERNANCE=41 ✓, OFF_MINT_MINTED_TOTAL=141 ✓, OFF_MINT_BARE_RETIRED=454 ✓, OFF_MINT_CHARTER_CLOSES=442 ✓, OFF_MINT_SOL_RESERVE=257 ✓, OFF_MINT_MAX_SWEEP=266 ✓, OFF_MINT_COOLDOWN=274 ✓, OFF_MINT_SALES_STOPPED=191 ✓, OFF_MINT_SWEEP_STOPPED=192 ✓, OFF_MINT_SALES_STOPPED_AT=518 ✓, OFF_MINT_SWEEP_STOPPED_AT=526 ✓, OFF_MINT_SWEEP_FLOOR=631 ✓, OFF_MINT_COOLDOWN_CEILING=639 ✓, OFF_MINT_RESERVE_CEILING=647 ✓, OFF_MINT_MAX_BOOST_WEIGHT=711 ✓, OFF_MINT_MAX_BOOST_EPOCHS=712 ✓.

BURN reads: OFF_MINT_MINTED_TOTAL=141 ✓, OFF_MINT_BARE_RETIRED=454 ✓.

GOV's read_mint_config requires `d.len() >= OFF_MINT_MAX_BOOST_EPOCHS + 2` = 714. Actual config is 1261. ✓.

VaultRecord: disc 0..8, version 8, asset 9..41, mint_index 41..49, reveal_slot 49..57, level 57, charter 58, entropy_set 59, entropy 60..92, attrs_hash 92..124, bump 124, active 125, retired 126, reschedules 127..129 (u16), vault_ata 129..161, debt_scaled 161..177 (u128), pending 177, request_epoch 178..186, boost_weight 186, boost_end_epoch 187..195, carry_scaled 195..211, RECORD_PADDING 10 → 221. ✓ GOV reads OFF_REC_VERSION=8, OFF_REC_ASSET=9, OFF_REC_INDEX=41 ✓.

BURN BurnConfig: disc 0..8, version 8, collection 9..41, bump 41, burned_total 42..50, redeem_window_secs 50..58, rate_head 58, rate_ring 59..59+512=571, padding → 827. GOV reads OFF_BURN_VERSION=8, OFF_BURN_TOTAL=42 ✓.

Discriminators: MINT_CONFIG_DISC = sha256("account:MintConfig")[..8] = [168, 252, 88, 182, 219, 205, 39, 53]. Suite asserts (3.1p, 3.1u, 3.1v). SEAL_CONFIG_DISC [155, 12, 170, 224, 30, 250, 204, 130] (3.1y). BURN_CONFIG_DISC [90, 69, 15, 87, 119, 190, 109, 45] (3.1o). VAULT_RECORD_DISC [47, 1, 218, 116, 82, 70, 124, 119] (3.1n). These are suite-asserted. OK.

**Now, the web/ repairs (round 37's V1, V2, V3) — my R0 target.**

V1 repair: `vaultWalletAccounts` reads reserves by address, lists others bounded (dataSlice 8 bytes for balances, 0-byte for T22 addresses), full-reads at most 200. `planRedemption` turns incompleteness into one box. Let me check the repair for correctness.

In `vaultWalletAccounts`: reserves read by address via `accounts()` (getMultipleAccounts). Then three getProgramAccounts: classic (dataSize 165, owner at 32, slice 64..72), t22plain (T22, dataSize 165, owner, slice 64..72), t22all (T22, owner, slice 0..0). Then want = classic with balance>0 not seen + t22all not seen and not emptyPlain22. take first 200, read full.

Wait: `emptyPlain22` = t22plain with amount 0. t22plain is T22 accounts of dataSize 165. A T22 account of exactly 165 bytes with amount 0 — can that exist? T22 ATAs have ImmutableOwner → 170 bytes. A non-ATA T22 account could be 165 if no extensions. Empty → skipped. OK.

Hmm, but there's a subtlety: `t22all` uses `dataSlice: {offset:0, length:0}` and filter only byOwner (offset 32). T22 accounts with the owner at offset 32 — all T22 token accounts have owner at 32. OK.

But wait: the proxy's gpaShape for 'token22-owner' requires `!sized && noData && exactly([[32, is32]])`. And 'token22-owner-amounts' requires sized && slice(64,8) && exactly([[32,is32]]). And classic 'token-owner-amounts' same with TOKEN. OK matches.

V2 repair: `resolveCollection` — pins from config.js, SEAL, launch file, browser memory, session; two differing pins → STOP; one pin wins, others on chain ignored; no pin → adopt only if created by launch key (collectionCreator checks first tx naming it). Looks reasonable. The e2e and ceremony tests cover it.

V3 repair: `planActivate` no longer refuses frozen; adds note. Check: `const frozen = !!vaultToken && vaultToken.state === 2`. For pending join: returns join with note. For request: `if (!vaultToken || (vaultToken.state !== 1 && !frozen))` refuse; so state 1 or frozen(2) with balance >= 21000 → ok. MINT's activate reads balance only (read_token returns amount, state discarded: `let (amount, _) = read_token(...)`). ✓ matches.

**Now let me hunt for NEW bugs in the programs.**

Let me look at `claim` more carefully for the frozen-destination path:

```rust
if d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN {
    msg!(...); emit!(ClaimDeferred...); n_deferred += 1;
    if touched { store_record(ri, &r)?; }
    continue;
}
```

`touched` = a due boost was expired on this record. So expiry persists even if payment deferred. Fine (BO.37).

But note: if NOT touched and pay==0, `continue` without storing — fine, nothing changed. If pay>0 and dest frozen: defer, owed stays. Fine.

What if `dest` is not owned by SPL_TOKEN or lamports==0 → VaultAccountMissing refuses the WHOLE claim. Hmm: "A missing or non-token account REFUSES the whole call: a claim never creates one." So one vault whose recorded ATA was... can a vault's ATA be closed after activation? The ATA is owned by the vault's asset-signer PDA. Only Core Execute can sign for it, only when thawed (redemption) — which retires the record. Or the owner... no, the PDA owns it. A close authority? The ATA's close authority is none by default. So the ATA can't be closed while sealed. But wait — the sweep helper closes it during redemption, and retire happens in the same tx. OK.

But here's a thing: `claim` refuses the whole batch if one vault's account is missing. The crank sends batches; one bad vault blocks the batch. But it can't be missing (above). OK.

**`join` in claim:** `require_keys_eq!(dest.key(), r.vault_ata, ...)`. For a pending vault, vault_ata was recorded at request. If a claim names a pending vault with the wrong dest → refuses whole batch. The crank uses recorded vault_ata. OK.

**A subtle one in `claim`:** the same vault twice in one claim. First pair: pays, sets debt=weight*acc, carry=remainder. Second pair (same record): load_record reads the STORED record (stored after first). owed = weight*acc + carry - debt = remainder < SCALE → pay=0 → skip (or if touched... not due anymore). So paid once. BO.32 measured. OK.

**`retire_redeemed` stack height check:** `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1`. BURN calls it via `invoke` (not invoke_signed) — stack height: top-level instruction is height 1 (TRANSACTION_LEVEL_STACK_HEIGHT=1), BURN's burn_vault runs at 1, its CPI into MINT runs at 2 = 1+1. ✓. And it checks the top-level instruction at `cur` is burn_vault for this asset. `load_current_index_checked` inside MINT (at height 2) returns the top-level instruction index. ✓.

Could someone call retire_redeemed directly at top level? Stack height would be 1, not 2 → NotFromBurn. Via a wrapper: wrapper at 1, MINT at 2, but top-level instruction is the wrapper, not burn_vault → NotFromBurn. WR.1 measured. ✓.

**Now BURN's `burn_vault` — the `declared` count:** `require!(ctx.remaining_accounts.len() == declared as usize, DeclarationMismatch)`. declared is u8, so max 255 accounts. Fine.

**Reserve loop detail:** for each mint, for each of the two token programs, derive ATA, find in remaining. `ok_or(ReserveNotDeclared)`. So all 6 ATAs (3 mints × 2 programs) must be declared. If a reserve ATA doesn't exist, it's declared as a non-existent account (system-owned, 0 lamports, 0 data) → skipped by `if acc.owner != SPL && != T22 { continue }`. ✓.

But WAIT: what if a reserve ATA exists but is owned by SPL Token with len != 165? Classic SPL token accounts are always 165. A mint account is 82. Could someone make the ATA address hold a non-165 token account? The ATA address is a PDA of the ATA program; only the ATA program creates accounts there (via Create), always 165 for classic. R34.G2 measured: a stranger can't take an ATA address. So no.

What if `d.len() < TOKEN_ACCOUNT_LEN` (e.g., 82-byte mint at the ATA address — impossible per above) → `continue` (skipped). Hmm, that's a skip for a token-owned account shorter than 165. Can't happen for real ATAs. OK.

**The second loop (non-reserve declared accounts):** skips Core assets unless live AssetV1. `require!(d.is_empty() || d[0] != KEY_ASSET_V1, VaultStillHoldsAVault)`. A burned Core asset (1 byte, key 0) passes. A live nested vault (d[0]==1) refuses. ✓. Non-Core, non-token, lamports>0 accounts: skipped (e.g., a system account with lamports declared — its lamports aren't checked! Wait: `if acc.lamports() == 0 { continue; }` then `if acc.owner != SPL && != T22 { continue; }`. So a declared system account with lamports is skipped — but those lamports belong to... the account is whatever it is; BURN only cares about the PDA's lamports (asset_signer.lamports()==0, checked separately). A declared account with lamports owned by someone else is irrelevant. ✓.

**SEAL's open: does it check the vault is not already thawed?** set_frozen(false) on an already-unfrozen... can a vault be unfrozen outside redemption? Only SEAL's PDA can thaw (plugin authority), and SEAL only thaws in open_for_redemption. So no.

**MINT `initialize` — the royalty CPI:** AddCollectionPluginV1 with authority None. Accounts: collection (w), authority (signer, w) — wait: `AccountMeta::new(ctx.accounts.authority.key(), true)` — the authority (INIT_AUTHORITY) is payer? And mint_pda as the plugin authority signer via invoke_signed. Let me look at the account list: collection, authority (signer, writable), mint_pda (readonly, signer), system_program, MPL_CORE. The invoke_signed signs with MINT_SEED. So Core sees: collection, payer=authority, authority=mint_pda (the collection's update authority), system, core. AddCollectionPluginV1 requires the update authority to sign — mint_pda signs via seeds. ✓ (suite R.1-R.4 verify the royalty landed with authority None).

**GOV `execute_proposal` — the CPI account list:** `AccountMeta::new(mint_config, false)`, `AccountMeta::new_readonly(gov_pda, true)`. MINT's Governed context: `#[account(mut, seeds=[CONFIG_SEED], bump, has_one=governance)] config`, `governance: Signer`. So config must be writable (it is), governance must sign (gov_pda via invoke_signed). ✓.

**Potential issue — GOV `create_proposal` with `SetRound` where opens_at in the past:** allowed (suite creates rounds with opens_at=now-60). closes_at > opens_at, <= 1 year. Fine.

**`execute_proposal` — `read_stops` reads mint config again (already read). Fine.

**Now the off-chain/web focus of this round.** The prompt says R0 includes web/. Round 37's repairs are in web/. Let me look for NEW bugs in web/ that lose holder value.

**`planRedemption` — the claim dest:** `IX.poolClaim(ids, pool, [{ asset, dest: ata(pda, s.mintConfig.payment_mint) }])` — pays into the vault's own account (the PDA's ATA), which the sweep then empties. ✓ (claim must pay into vault's recorded vault_ata; is `ata(pda, payment_mint)` == recorded vault_ata? Activation recorded `vault_ata = ATA(signer_pda, payment_mint)`. Same. ✓).

**The sweep helper destination:** owner. Pairs: reserves + helperStrays → [source, ownerAta(mint)]. The helper checks to_owner==dest (owner) and to_mint==src_mint. ownerAta(m) is the owner's ATA for mint m — owner field is owner. ✓.

**C5 transfer strays:** `IX.tokenTransfer(a.address, ownerAta(a.parsed.mint), pda, a.parsed.amount)` via coreExecute with authority=owner. The transfer's authority is pda (the vault wallet), signed by Core. ✓. Amount = pre-read balance. If a stranger deposits more into the C5 account after the plan, the transfer moves only the pre-read amount; the rest stays, account undeclared, not empty... wait — BURN's second loop: the C5 account is UNDECLARED (not in declared list), so BURN doesn't see it. It keeps the leftover. Item 44/35 C5: "leaves the empty account undeclared" — but if a late deposit landed, it's not empty; it's still undeclared, so the burn proceeds and the leftover is destroyed. The page's note says "Anything sent to that account after this check stays in it." Stated. OK.

**Now — a potential real issue in planRedemption: the `claim` when the vault's cbBTC ATA (vault's own) is frozen.** The reserve loop: `else if (t.state === TOKEN_FROZEN && t.amount > 0n) refuse`. But if frozen with amount 0 and owed>0: claim pays into the frozen account → the Transfer into a frozen account reverts → whole redemption reverts. Hmm! Let me check: claim pays into the vault's cbBTC account (dest = ata(pda, cbbtc)). If that account is FROZEN, the pool→vault transfer fails (Token program refuses transfers to frozen accounts, error 0x11). So the redemption reverts.

Does the page catch this? The reserve loop: `t.state === TOKEN_FROZEN && t.amount > 0n` → refuse. But if amount == 0 and frozen and the vault is owed (active), claim is included, and it reverts on chain. The page's dry run (simulate) would catch it: "The network's dry run of the opening failed, so nothing was sent". So the holder is told the dry run failed. Not a loss, but a block: the vault can't be opened while its cbBTC account is frozen with 0 balance but owed a share. Actually item 28 says a frozen vault account blocks the whole redemption — stated, accepted. The page refuses (amount>0) or dry-run fails (amount==0, owed>0). Either way blocked, as stated. OK, not new.

**What about `planRedemption` when the vault's cbBTC account doesn't exist but the vault is active (owed)?** The reserve loop: `if (!acc) priorIxs.push(create vault's cbBTC account)`. So it's created in the prior tx. Then claim pays into it, sweep empties it. ✓. But wait — can an active vault's cbBTC ATA not exist? Activation required it to exist with 21000 sats. It can't be closed while sealed. So it exists. Defensive anyway. ✓.

**`rateLimit` in plan-redeem:** mirrors BURN. live = minted - burned - bare. cap = ceil(live*210/10000) min 1, k=min(cap,64). kth = ring[(head+64-k)%64]. allowed = now - kth >= win. ✓ matches BURN.

**Now the proxy (round 36 L1, round 37 W6):** `txRefusal` — transactions must call only TX_PROGRAMS and at least one CBOB program, OR be exactly: ATA creates only (data [1]), the ceremony collection create (Core, data[0]==21, accts[1]==MINT_AUTH), or System transfers to REVENUE (data len 12, readUInt32LE(0)==2, accts[1]==REVENUE).

W6: a no-op CBOB instruction carries anything else — stated in README, accepted. 

Hmm, but: "System transfers to the revenue address" — `work.every(ix => ix.prog === SYSTEM && data len 12 && data.readUInt32LE(0)===2 && ix.accts[1]===REVENUE)`. System transfer instruction: data = u32 instruction index (2) + u64 lamports. accts[0]=from (signer), accts[1]=to. So transfers TO revenue. Anyone can send SOL to revenue anyway (it's a PDA; the sweep handles it). Not a hole.

The ATA-create-only shape: `work.every(ix => ix.prog===ATA_PROG && data.len==1 && data[0]==1)` — CreateIdempotent. Anyone can create ATAs anyway (permissionless). The proxy relaying it just means the proxy pays... no, the sender pays. The proxy just relays. Rate-limited. Fine.

Collection create: `work.length==1 && prog===CORE && data[0]===21 && accts[1]===MINT_AUTH`. CreateCollectionV2 with update authority MINT_AUTH. A stranger could relay a decoy collection create through the proxy — but they can do that with any RPC. The ceremony's V2 repair handles decoys. Fine.

**Now let me look at the ceremony's `judgeProgramBytes`:** checks pd.elf first `len` bytes hash to sha256, rest zero. ✓ (SPEC road step 9).

**`judgeProbe`:** anchor → Custom 101 (InstructionFallbackNotFound); sweep → InvalidInstructionData; placeholder → "CBOB placeholder" log. ✓.

**Now, let me look harder at MINT for a real bug. The boost/claim/distribute accounting is the money core.**

`claim` — the payment: `invoke_signed` SPL Transfer from pool_token to dest, signed by config PDA (CONFIG_SEED, bump). The config PDA is the pool's token account owner. ✓.

`owed_paid` accumulates `settled = pay*SCALE` per vault; at end `c.owed_scaled -= owed_paid`. ✓.

But NOTE: `claim` does NOT check that the pool has enough balance! It transfers `pay` from the pool; if the pool is short, the Transfer reverts (insufficient funds) → whole claim reverts. So a short pool blocks claims. Can the pool be short? Invariant: pool >= ceil(owed). distribute refuses PoolShort. monthly_inline uses saturating_sub (credits only avail). So pool >= owed always. Unless... a frozen pool deferral keeps owed. Fine.

Hmm wait, actually there's a subtle invariant issue. `monthly_inline` computes `avail = balance.saturating_sub(ceil_sats(c.owed_scaled))`. If balance < ceil(owed) (pool short — shouldn't happen), avail=0, no credit. OK.

`distribute`: `avail = balance.checked_sub(owed).ok_or(PoolShort)`. OK.

**The `credit` function's `owed_scaled` increment:** `delta * w` where delta = avail*SCALE/w (floor). delta*w <= avail*SCALE. So owed grows by <= avail sats worth. But the CEIL: owed_scaled increases by delta*w (scaled). ceil(owed_new) <= ceil(owed_old) + avail? owed_new = owed_old + delta*w. Since delta*w <= avail*SCALE, ceil(owed_old + delta*w) <= ceil(owed_old) + avail (because delta*w/SCALE <= avail, and ceil(a+b) <= ceil(a) + ceil(b) <= ceil(a)+avail since avail integer). ✓. Pool balance unchanged by credit. So pool >= ceil(owed) preserved. ✓.

**`join`:** debt = w*acc, carry=0. owed=0. total_active_weight += w, active_count++, pending_count--. ✓.

**`reweigh` (boost buy):** carry=owed, debt=after*acc, total_active_weight += (after-before). owed unchanged. owed_scaled unchanged. ✓.

**`expire_boost`:** unschedule + reweigh(0). ✓.

**`retire`:** owed_scaled -= pending; total_active_weight -= w; active_count--; unschedule boost; debt=full (so owed=0 after); carry=0; active=false. For forfeit, pending>=SCALE allowed, returned to pool (owed_scaled -= pending, so the pool keeps it). ✓.

Wait — in retire, for the redeemed non-forfeit case: `require!(pending < ACC_SCALE, ClaimBeforeBurn)`. So the redeemer must claim first (pending < 1 sat). The sub-sat residue: owed_scaled -= pending (sub-sat), so it stays in the pool (pool holds it, no longer owed). ✓.

**Now `retire` for a pending (not active) vault:** skips the active block, then `if r.pending`: pending_count--, and `if r.request_epoch == c.dist_epoch { pending_this_epoch-- }`. ✓ (F21 measured).

Hmm — what if a vault is BOTH active and pending? Can't be: pending set at request, cleared at join (active set). retire checks active first, then pending. A record has pending XOR active (join clears pending when setting active). ✓.

**`activate` first call:** requires !retired, !active, !pending (via the pending branch returning join... wait: `if r.pending { ...join or ActivationPending }`. If pending and dist_epoch <= request_epoch → ActivationPending error. If pending and dist_epoch > request_epoch → join. So a second activate call joins. First call: requires level 1..5, asset live, vault_token is the canonical ATA, amount >= 21000. Sets pending, request_epoch=dist_epoch, vault_ata. pending_count++, pending_this_epoch++. ✓.

**Boost gate interaction:** `boost_vault` requires active && !retired && !pending. ✓.

**`distribute` w==0 path:** `require!(!burn && c.pending_this_epoch > 0, NoActiveVaults)`. So the free tick only when someone requested THIS epoch. And waiting_to_join==0 (no earlier-epoch waiters). And month elapsed. tick advances epoch. ✓.

Hmm, wait: what if total_active_weight==0, pending_this_epoch>0, but boosts_due>0? Checked before: BoostsExpireFirst. But can boosts be due with w==0? Due boosts belong to active vaults (w>0). If all retired, unschedule removed them. So boosts_due==0 when w==0. The check is harmless. ✓.

**`monthly_inline` when w==0 and pending_this_epoch>0:** tick. But what if boosts_due>0? Returns early (waits). Same reasoning. ✓.

**Now the draw's `reveal_level` for a burned vault:** skips the Core write but still draws and counts. `is_burned` check: owner==Core, len==1, d[0]==0. ✓. But note: for a NON-burned vault, it requires the asset be a live AssetV1 (`d[0]==KEY_ASSET_V1`) — but does NOT check the asset is in our collection there... wait it does: `require_keys_eq!(ctx.accounts.collection.key(), ctx.accounts.config.collection)` and `require_keys_eq!(ctx.accounts.asset.key(), asset)`. But does it check the ASSET is in the collection? It checks the asset account is Core-owned AssetV1, and the collection account matches config. But the asset's OWN collection pointer (d[34..66]) is not checked in reveal_level! Hmm. The record's asset is genuine (created by MINT into our collection). reveal_level is keyed to the record (vault_record PDA seeds [VAULT_SEED, vault_record.asset]). The asset account passed must equal record.asset. The record was created at mint with the asset in our collection. So the asset is ours. The UpdatePluginV1 is signed by mint_authority (the collection's update authority + attributes plugin authority). Fine. ✓.

**`capture_entropy` / `reschedule_reveal`:** keyed to record PDA. ✓.

**Now, GOV's `read_vault_index`:** reads record at PDA ["vault", asset] under MINT, checks disc, version, asset field == asset. Returns mint_index. ✓.

**GOV `cast_vote`:** the vault_record account is `UncheckedAccount`, verified in read_vault_index (PDA + owner + disc + version + asset). ✓.

**GOV `create_proposal`:** vault_asset read via read_core_asset (owner+collection). But it does NOT check the vault has a record / is not retired! A burned vault: read_core_asset requires d[0]==1 (live AssetV1), so burned fails. A retired-but-not-burned vault? Retired means burned (retire only happens on burn). So live asset ⟺ not retired. ✓. Actually wait — can a vault be retired while live? retire_redeemed requires is_burned(asset). retire_burned requires is_burned. So no. ✓.

**GOV proposal with `Brakes{set_guardian:true, guardian: Some(x)}` where x is off-curve:** arm_guardian stores it; apply sets it. An off-curve guardian can never sign → brake can never be pulled → but also can't be abused. The suite tests guardian None (retire). Off-curve guardian: the alarm... item 38 says off-curve keys accepted. A vote to set an off-curve guardian would permanently remove the brake (nobody can stop) — but that's a vote's choice. Not a bug.

**Now let me think about R1s(b) more: "a source is a native wSOL account".** read_token reads mint/owner/amount. A native wSOL account: mint = wSOL mint, owner = vault PDA, amount = lamports. The helper transfers `amount` to dest's wSOL account (must exist, same mint, owned by dest). Then closes → rent+reserve to dest. Fine. But the destination for wSOL: owner's wSOL ATA. The page would need to create it. Edge case, works.

**"a source has a delegate or close authority":** the helper doesn't check delegates! It transfers (owner signs via Core) and closes (owner signs). A delegate on the source doesn't block the owner's transfer/close. Close authority: if someone else holds close authority on the vault's account — can that happen? The account's owner is the vault PDA; only the owner can set close authority (SetAuthority needs owner signature). The vault PDA signs only via Core Execute (owner's call) or... the helper itself. So a close authority on a vault account could only be set by the owner via Execute. C5 is the reverse: a stranger creates an account, keeps close authority, then sets owner to the vault PDA. Then the helper's close reverts (close authority is the stranger, not the vault PDA — wait, CloseAccount requires the OWNER or the close authority to sign. The helper signs as the owner (vault PDA via Core). Hmm: SPL CloseAccount: if close_authority is set, does the owner still work? No! CloseAccount: "if close_authority is present, it must sign; otherwise owner must sign"? Let me recall: `CloseAccount` checks: if the account has a close_authority (COption), then the close authority must sign; else the owner signs. Actually the code: 

```rust
let authority = if let Ok(close_authority) = account.close_authority() ... 
```

In spl-token close_account: `let authority = account.close_authority().unwrap_or(account.owner)` — no wait. Let me recall precisely:

```rust
// spl-token/src/processor.rs, process_close_account
let owner = if account.is_native() ... 
```

Actually: `let close_authority = account.close_authority()?;` — the authority expected is `close_authority.unwrap_or(owner)`. So if a close authority is set, ONLY it can close (the owner cannot!). That's the C5 trap: stranger sets close authority to themselves, then owner to vault PDA. The vault PDA (via helper) tries to close → the close authority is the stranger → owner signature insufficient → reverts. R36.C5 measured exactly this (0x4 = owner/authority mismatch). ✓. And the page moves the balance via plain Transfer (owner can always transfer) and leaves the account. ✓.

**Helper: does it check the source's delegate?** No, but owner-transfer works regardless. Fine.

**Now, one thing to verify in the helper: the destination read.** `read_token(to)` requires to be SPL-owned, 165 bytes. If the destination ATA doesn't exist → read fails → whole Execute reverts → redemption reverts. So the page MUST create destination ATAs first (item 42). ✓.

**Helper lamport sweep when dest is the fee payer:** owner pays fee, exists. ✓.

OK. Now let me look at **web/ redeem page flow** for a value-loss bug.

In `redeem.mjs` show(): the dry run watches owner ATAs and the asset. Checks burned. Then signs and sends. The re-plan before signing: `freshPlan(asset, true, dropStrays)` with noPrior=true. If fresh.plan.prior.length — with noPrior=true, canReceive requires ownerAtaExists; strays without owner accounts → noAccount → left behind (ack). Reserves: needOwnerAta always includes reserves; if owner's reserve ATA missing and noPrior... `if (!s.ownerAtaExists.has(a)) priorIxs.push(...)`. Wait, in the re-plan with noPrior, the reserve owner ATAs: `for (const m of needOwnerAta) { if (!s.ownerAtaExists.has(a)) priorIxs.push(...) }` — this is OUTSIDE the noPrior check! Let me re-read:

```js
const canReceive = a => !s.noPrior || s.ownerAtaExists.has(ownerAta(a.parsed.mint).toBase58())
const noAccount = [...helperStrays, ...transferStrays].filter(a => !canReceive(a))
...
for (const m of needOwnerAta) {
    const a = ownerAta(m).toBase58()
    if (!s.ownerAtaExists.has(a)) priorIxs.push({ why: ..., ix: ... })
}
```

So in the re-plan (noPrior=true), if the owner's reserve ATA is missing (shouldn't be — created in prior tx), it would push a prior ix, and then `if (fresh.plan.refuse.length || fresh.plan.prior.length)` → "Something changed... Check it again." So it refuses to proceed and asks to re-check. Not a loss. OK.

**The `signExact` guard:** wallet must not change the message. ✓.

**Now the claim page:** `planClaim` — checks window, supply, pobSet collection matches, root recomputes, pobCollection no external plugins, wallet holds a PoB (live, owned, in collection), pick not frozen, no external plugins. Builds claimCharterVault with proof, pob_extra=0, no crank. ✓. The claim burns the PoB — the page shows "Burned: Proof of Burn #N". ✓.

Hmm — `planClaim` checks `pick.info.plugins.externalCount` and frozen. But a PoB with a PermanentFreezeDelegate frozen → refused. What about a PoB with a FreezeDelegate NOT frozen? Fine, burn works.

What about the PoB's collection (Moments) having an external plugin added between read and send? The burn would fail (Core refuses without pass-through) → dry run catches it. The page sends pob_extra=0. Stated (item 46). ✓.

**Buy page:** `planBuy` — checks sales not stopped, round open, not sold out, supply, payer has cbBTC (not frozen, enough), revenue account exists. max_price = price read. ✓.

**Now the vault page rescue:** `planRescue` — checks vault live, in collection; host = self if owner==own deposit address; else host's deposit address must == vault's owner; host must be self / burned Core / live CBOB vault; else refuse. dest = bank_treasury. ✓ matches MINT.

**Now — a deeper look at MINT's `rescue_nested`:**

```rust
require_live_vault(&a.vault, &a.config.collection)?;
let owner = { read vault owner bytes };
let host = a.host.key();
let (signer_pda, _) = find_program_address([EXECUTE_PREFIX, host], MPL_CORE);
require_keys_eq!(owner, signer_pda, NotNested);
let orphan = host == a.vault.key() || is_burned(&a.host)?;
if !orphan {
    require!(require_live_vault(&a.host, &a.config.collection).is_ok(), HostUnresolved);
}
let dest = a.config.bank_treasury;
require_keys_eq!(a.new_owner.key(), dest, WrongRescueDestination);
invoke_signed(TransferV1 ... rescue_authority ...)
```

Wait — `require_live_vault(&a.host, ...)` for the live-host case: host must be a live vault of our collection. But the check is `.is_ok()` wrapped in require — fine. For orphan (host==vault or burned): no live check. For host==vault: the vault's own signer PDA owns it. ✓.

Hmm, one subtlety: `is_burned(&a.host)` — host is Core-owned, 1 byte, key 0. But what if host is a LIVE FOREIGN asset (not our collection)? Then orphan=false, require_live_vault fails → HostUnresolved. ✓. What if host is a live CBOB vault but the vault's owner is host's signer PDA — that's the nested case. ✓.

What if host is a burned CBOB vault vs a burned foreign asset? is_burned doesn't check collection — any burned Core asset works. A vault nested in ANY burned asset's wallet is orphaned (nobody can sign). ✓ (R35.N5).

What if host is a non-Core account (system, token)? is_burned false (owner != Core), orphan = host==vault || false. If host != vault: require_live_vault fails (owner != Core) → HostUnresolved. ✓ (R35.N7: never-created host — host is a keypair's address, no account → is_burned: try_borrow_data on a non-existent account... a non-existent account passed to the tx appears as system-owned, 0 lamports, 0 data. is_burned: owner != MPL_CORE → false. require_live_vault → owner != Core → NotALiveVault → is_ok() false → HostUnresolved. ✓).

The TransferV1: accounts vault(w), collection(r), payer(signer,w), rescue_authority(r, signer via seeds), new_owner(r), system, core. data [IX_TRANSFER_V1, 0]. Core checks the permanent transfer delegate authority (rescue PDA) signs. ✓.

**Now, is there anything in the sweep helper's interaction with BURN's "declared" that breaks?** The helper closes reserve accounts. BURN's reserve loop: declared ATA, if owner is SPL/T22 and len>=165 → checks. A CLOSED account: owner is... after SPL close, the account is assigned to the System program and data cleared? If so, `acc.owner != SPL && != T22` → skip. ✓ (the closed account passes for the right reason — R1s(e) asks to show this; SR.4/S8 measured the full redemption lands with closed accounts declared).

Actually wait — does SPL CloseAccount change the owner to System? Let me think again. In spl-token (the pinned mainnet version), `process_close_account`:

```rust
// Transfer the lamports and delete the account
let dest_starting_lamports = dest_account_info.lamports();
**dest_account_info.lamports.borrow_mut() = dest_starting_lamports.checked_add(source_account_info.lamports())...;
**source_account_info.lamports.borrow_mut() = 0;
// then:
source_account_info.assign(&system_program::ID)?; // ? 
source_account_info.realloc(0, ...)?;
```

Hmm, I believe modern spl-token does `delete_account`: sets lamports to 0, assigns owner to System, reallocs data to 0. Actually there's a helper: in spl-token 4.x, close_account ends with:

```rust
// Delete the account
**source_account_info.lamports.borrow_mut() = 0;
source_account_info.assign(&system_program::ID);
source_account_info.realloc(0, false)?;
```

Something like that. Either way, owner != SPL after close → BURN skips. Measured in suite (SR.4, S8 redemptions land). ✓.

**Now the big one to check — R2's invariant "pool always holds ceil(owed)" and liveness.**

Liveness: can anyone make distributions impossible? `distribute` requires boosts_due==0 and waiting_to_join==0. Boosts due: anyone can expire (expire_boosts, free, records only). Waiting: anyone can join via claim (free). So no permanent block. But: can someone GRIEF by keeping a vault perpetually waiting? A vault requests activation (needs 21000 sats in its account — real money). It waits one distribution. Anyone can join it. No grief.

Can someone make redemptions impossible for others? The rate limit: 2.1%/hour. An attacker redeeming own vaults spends the budget (accepted limit 32). 

**A subtle one: `claim`'s join path and the JoinWaitingFirst gate.** After a distribution, waiting vaults (request_epoch < dist_epoch) can be joined by any claim naming them. The gate `waiting_to_join = pending_count - pending_this_epoch`. If a vault requested in epoch E and dist_epoch is now E+1, it's waiting (pending_count includes it, pending_this_epoch was reset to 0 at advance). So waiting_to_join > 0 → no distribution until joined. Anyone can join it via claim (needs the record + its vault_ata account). The vault_ata exists (activation required it). So joinable. ✓.

But: what if the vault's vault_ata is FROZEN (Coinbase)? The join path in claim: `if r.pending { require dest==vault_ata; if dist_epoch > request_epoch { join } continue }`. Join doesn't transfer — it just records. A frozen account doesn't block the join (no transfer). ✓ (round 37 C02: the crank joins during a frozen pool; joins don't touch the pool).

Wait, but claim's join happens BEFORE any payment in the same claim? The pairs are processed in order; a join pair doesn't touch the pool. A claim with [joinPair, payPair]: join first, then pay. If pool frozen, pay reverts whole tx (including the join). Round 24 D4: "a join goes through only in a claim that pays nothing (the crank sends join-only batches)". Stated. ✓.

**Now — a potential NEW issue: `claim`'s monthly_inline runs BEFORE the pairs.** `{ monthly_inline(...) }` after the crank. So a claim when the month is due: monthly_inline credits (if pool not frozen etc.), THEN pairs pay out including the new distribution. Fine.

But monthly_inline in claim: if it credits, owed grows; then claims pay. Pool balance sufficient (invariant). ✓.

**`retire_redeemed`'s monthly_inline runs AFTER retire.** So the redeemed vault doesn't get credited. ✓ (stated).

**Now let me check `boost_vault`'s monthly_inline placement:** runs FIRST (before the boost), so a due month credits at the OLD weight. ✓ (BO.22 measured).

**`activate`'s monthly_inline:** runs before the activation (after the crank). "a month's revenue belongs to the vaults that were active during it". ✓.

**`mint_vault`'s monthly_inline:** first thing. ✓.

**`claim_charter_vault`'s monthly_inline:** after splitting extra/crank accounts, before the claim. ✓.

OK, the programs look tight. Let me now focus on what this round specifically asks: R0 (round 37's verdict verification + web/), and the accepted limits.

**Round 37 V1 repair verification:** The repair bounds the reads. Let me check `vaultWalletAccounts` for a hole: the reserves are read by address FIRST (via `accounts()` = getMultipleAccounts). If THAT fails (network), `accounts` throws → ReadError → page refuses. Hmm: "the vault's three reserve accounts are read directly by address, always, so a failed listing can never hide them" — but if getMultipleAccounts itself fails, the whole read fails and the page refuses ("Could not read..."). Is that a block? A stranger can't cause getMultipleAccounts-by-address to fail (bounded: 3 addresses). Only a network/proxy failure. That's not stranger-caused. ✓.

The three getProgramAccounts are in Promise.all; if any fails → catch → incomplete.unlisted set, reserves still returned. ✓. Then the full reads (at most 200, 100/call): if that fails → `incomplete.unexamined += take.length`. ✓.

`planRedemption`: `inc.unlisted` → one box 'unlisted:all'; `inc.unexamined` → one box. Never refuse. ✓. And the coverage cross-check: `judgeRedemptionCoverage(owned, [...covered])` — with an incomplete read, `owned` only has what was read; judged.reasons would only cover those. The named set includes ack ids. If judge finds something not named → refuse. With unlisted reads, judge finds nothing extra (it only sees what was read). So no false refusal. ✓.

Hmm wait — there's a subtle issue: when the listing is incomplete, a stray that WAS read (in the first 200) and is deliverable goes through the helper. Fine. A stray beyond 200 → unexamined box. Fine.

**V2 repair verification:** `resolveCollection` — looks right. `collectionCreator` reads the FIRST transaction naming the collection (oldest), checks it succeeded, fee payer+signer is launch key, and it's a CreateCollectionV2 for that address. Bounded at 5 pages of 1000. If padded beyond → unverifiable → ignored (not adopted, not a stop). ✓.

Edge: `collectionCreator` checks `keys[0] === initAuthority` (fee payer) and `msg.header.numRequiredSignatures > 0`. And `creates` = some instruction is Core CreateCollectionV2 (data[0]==21) with accountKeyIndexes[0]==collection. Hmm — could a transaction by the launch key include a create for address X but the collection account at index 0 of that instruction is X? `keys[ix.accountKeyIndexes[0]] === collection` — the first account of CreateCollectionV2 is the collection (signer, writable). ✓. And it must be the FIRST (oldest) transaction naming it. Since a fresh keypair address is unknown before its creation, the first tx naming it is the create. ✓.

But: what if the launch key's FIRST transaction naming the collection is a create that FAILED (meta.err)? → by:'other'. Then a later successful create by the launch key wouldn't be adopted (only oldest checked). Edge: a failed create then a successful one. The failed one is first → 'other' → ignored → step 0 offered again → creates a NEW collection. Hmm, but the failed create means the address wasn't created (failed tx). So a later create could succeed. The check looks only at the oldest. If oldest failed, the address might still have been created later. resolveCollection would ignore it (by:'other'), and step 0 creates a new one. Not a loss — just a new collection. The old address, if it exists, would be a decoy-like leftover. But wait: if the oldest tx failed, the collection doesn't exist at that address (a failed create leaves nothing). Actually a failed CreateCollectionV2 — the account might have been created by the System program first? Core's create does it in one CPI; a failure reverts. So no account. Then `account(conn, remembered)` check: remembered requires the account to exist on chain (`if (!a || !a.owner.equals(base.CORE)) remembered = null`). And `discovered` comes from collectionsOfMint (existing collections). So a failed-create address isn't discovered. ✓.

**V3 repair:** verified above.

**Now the four questions on accepted limits.** Let me pick the most valuable to attack:

**Item 40 (Core upgradeable) / N3:** "who may act through a vault's wallet" — the sweep helper's access control is Core's ExecuteV1 rule on a thawed vault. Verified by SR.5/5a/5c/5d. Is it worse? The claim: only the owner can Execute. Read at Core e72d63e: asset approves Execute only for authority==owner; collection abstains; AgentIdentity adapter can approve others but needs collection update authority (MINT PDA) to add, and our programs never add it. Measured. I can't re-measure here; the reasoning reads sound.

**Item 46 (PoB hot wallet):** "Is SPEC 46 complete?" The hot wallet can: add plugins to collection/assets, flip oracle. It cannot transfer/burn PoBs (measured R32.A22a). It can end the project or capture governance during the window. Stated in full. Anything omitted? The hot wallet is also... the collection's update authority can it change the collection's royalties? The Moments collection has its own royalties plugin (not ours). Irrelevant to us. Can it move a PoB out of the collection? "Moving a Proof of Burn out of the collection is the same brick class as a rejecting hook" — stated. Can it change a PoB's name/uri? Yes (update authority) — but identity is by address (Merkle root), so irrelevant. Can it ADD assets to the collection? Yes, but they're not in the Merkle set. ✓. Complete as stated.

**Item 32 (rate limit):** "Is it exactly a rolling window over a 64-slot ring?" Verified above. RL.2/3/4/7 measured. The ring bounds cap at 64; live>3047 → stricter. Stated. One thing: "live = minted - redeemed - RETIRED bare burns" — a bare-burned vault counts until retired. Round 24 D8 stated. ✓.

**Item 55 (unsplit revenue join):** accepted, stated. Is it worse? A vault joins and shares unsplit revenue. Cost 100-200 $GARY. Bounded by crank's hourly split. During a crank stall it grows — stated (revenue_unsplit pages). ✓.

**Item 25/26 (draw):** stated, buyer-facing. C's leader chooses among many draws. Is it worse? The FIFO and reschedule logic verified. The cohort effect (same-slot mints share hashes) stated. ✓.

**Item 27 (claim into dead account):** accepted. The crank retires bare burns first. ✓.

**Item 28 (Coinbase freeze):** stated, buyer-facing. The forfeit path (3c.F) measured. ✓.

**Item 44 (undeclared airdrops destroyed):** stated, buyer-facing. The sweep helper covers classic strays. ✓.

**Item 43 (off-curve owner can't redeem):** stated, buyer-facing, alarmed. ✓.

**Item 58 (rescue):** verified above. The Squads can vote with a held vault — "a custody rule, not a program one: it does not". Stated. Is it worse? The Squads holds a rescued vault until returned; it CAN vote (one vote). Bounded. Stated.

**Item 52 (pool/Squads accounts must exist):** OPEN AND BLOCKING, road step 10 creates them. The ceremony's 'atas' step does it. ✓.

**Item 38 (initialize values):** OPEN AND BLOCKING. The checker + ceremony. ✓.

**Item 50 (pages):** OPEN AND BLOCKING, built not published. ✓.

**Item 22/53 (rehearsal):** OPEN AND BLOCKING. ✓.

Now, are any DISCHARGED items not actually discharged? Item 54 (compute): measured. Item 51 (boost): built, measured. Items 1a-24: gone with the Bank. 12/17: measured. 14: closed (DuplicateAttribute). 19: closed by construction. 30/31/33: discharged. These read consistently with the code.

**Now let me hunt for anything NEW in web/ that loses holder money — the prompt's R0 emphasis.**

Let me look at `planPayout` (the "Run a payout" feature, round 36 L2):

```js
export function planPayout(ids, { mintConfig: c, waiting, dueRecords, burner, garyMint }) {
  const due = BigInt(c.boosts_due), wait = BigInt(c.pending_count) - BigInt(c.pending_this_epoch)
  if (BigInt(dueRecords.length) !== due) refuse...
  if (BigInt(waiting.length) !== wait) refuse...
  const groups = []
  for (dueRecords chunks of 20) groups.push([expireBoosts(...)])
  for (waiting chunks of 14) groups.push([poolClaim(...)])
  groups.push([distribute(ids, pool, burner, garyMint)])
  ...
}
```

The join claims: `IX.poolClaim(ids, pool, waiting.map(r => ({ asset: r.asset, dest: r.vault_ata })))`. poolClaim pairs (record, dest). For a pending vault, claim's join path requires dest==vault_ata. ✓. The distribute burns 100 $GARY from the burner. ✓.

Issue: the expire groups run, then joins, then distribute. But MINT's distribute requires boosts_due==0 AND waiting_to_join==0. After expiries and joins, both are 0. ✓.