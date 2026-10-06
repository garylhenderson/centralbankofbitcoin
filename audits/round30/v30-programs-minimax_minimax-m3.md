[reasoning only]
The user has asked me to act as an independent security auditor for a complex Solana vault system. This is the v6 design with five programs (SEAL, MINT, BURN, GOV, and a sweep helper), the off-chain pipeline, and a holder guide. The system handles real Bitcoin (cbBTC) and other tokens.

Let me organize my approach:

1. **First, understand the scope and constraints**
   - 855-assertion suite, plus extensive off-chain tests
   - Round 29 verdict was NOT CLEAN (0/2 clean rounds, with M1, L1, D1, D2)
   - Five programs will become immutable at launch
   - Programs become IMMUTABLE - bugs cannot be fixed
   - This is a comprehensive re-audit of the whole tree, not just incremental

2. **My job**: Find real faults, NOT confirm prior work, NOT praise. Independent verification.

3. **Structure my audit by target:**
   - R0: Round 29's verdict and repairs
   - R1: SEAL's thaw/burn pairing
   - R1s: The sweep helper
   - R2: Community pool
   - R2b: $CBOB boost
   - R3: Level draw
   - R4: Governance
   - R5: Charter claim
   - R6: One-time configuration
   - R7: Cross-program reads
   - R8: Test suite and build as evidence

Let me start with detailed code review of each program. I need to look at:

**MINT (programs/cbob-vault-mint/src/lib.rs):**
- The huge file with initialize, mint, charter, pool, draw, governance actions, etc.
- Look for: integer overflow, logic errors, subtle state transitions
- The pool accumulator: `acc_scaled`, `owed_scaled`, `debt_scaled` arithmetic
- Two-step activation (pending → join)
- $CBOB boost ring of 64, wraparound behavior
- Round cap arithmetic

**SEAL (programs/cbob-vaults/src/lib.rs):**
- open_for_redemption walks instructions sysvar
- BURN_IX_ASSET_IDX = 0, BURN_IX_OWNER_IDX = 2 hardcoded
- `find=true` 2-element iteration (current index + 1, going until err)

**BURN (programs/cbob-vault-burn/src/lib.rs):**
- Rolling window of 64 redemption times
- Cross-program raw reads from MINT, SEAL
- Emptiness proof

**GOV (programs/cbob-vault-gov/src/lib.rs):**
- Per-kind ordering marks (last_round_id, last_guardian_id, last_arm_id, last_boost_id)
- KeyChangeNeedsHalf (4000 bps)
- Read of MINT config at hardcoded offsets

**SWEEP HELPER (programs/cbob-vault-sweep/src/lib.rs):**
- Native program, no anchor
- Reads from token account data
- Pair list validation

Now let me start reading carefully. I'll start with the MINT program since it's the largest and most critical.

Let me read MINT's initialize very carefully first:

```rust
pub fn initialize(
    ctx: Context<Initialize>,
    bank_treasury: Pubkey,
    swap_operator: Pubkey,
    guardian: Option<Pubkey>,
    sol_reserve_lamports: u64,
    max_supply: u64,
    max_sweep_lamports: u64,
    sweep_cooldown_secs: i64,
    level_caps: [u32; 5],
    payment_mint: Pubkey,
    pob_collection: Pubkey,
    pob_root: [u8; 32],
    charter_opens_at: i64,
    charter_closes_at: i64,
    monthly_secs: i64,
    notice_secs: i64,
    sweep_floor_lamports: u64,
    cooldown_ceiling_secs: i64,
    reserve_ceiling_lamports: u64,
    max_boost_weight: u8,
    max_boost_epochs: u16,
) -> Result<()> {
    require_keys_eq!(INIT_AUTHORITY, ...);
    // $CBOB mint check
    // Various bounds checks
    
    // Collection validation
    // SEAL wiring check
    // pool_ata derived
    
    let c = &mut ctx.accounts.config;
    let (gov_pda, _) = Pubkey::find_program_address(&[GOV_SEED], &GOV_PROGRAM_ID);
    c.version = MINT_CONFIG_VERSION;
    c.collection = collection_key;
    c.governance = gov_pda;
    c.pool_ata = pool_ata;
    c.round_id = 0;
    c.opens_at = 0;
    c.closes_at = 0;
    c.price = 0;
    c.cap = 0;
    c.minted_this_round = 0;
    c.minted_total = 0;
    c.max_supply = max_supply;
    c.bank_treasury = bank_treasury;
    c.split_bps = DEFAULT_SPLIT_BPS;
    c.sales_stopped = false;
    c.sweep_stopped = false;
    c.guardian = guardian.unwrap_or_default();
    c.swap_operator = swap_operator;
    c.sol_reserve_lamports = sol_reserve_lamports;
    c.bump = ctx.bumps.config;
    c.max_sweep_lamports = max_sweep_lamports;
    c.sweep_cooldown_secs = sweep_cooldown_secs;
    c.last_sweep_at = 0;
    c.level_caps = level_caps;
    c.level_minted = [0; 5];
    c.revealed_total = 0;
    c.payment_mint = payment_mint;
    c.pob_collection = pob_collection;
    c.pob_root = pob_root;
    c.charter_opens_at = charter_opens_at;
    c.charter_closes_at = charter_closes_at;
    c.charter_claimed = 0;
    c.bare_burns_retired = 0;
    c.total_active_weight = 0;
    c.active_count = 0;
    c.acc_scaled = 0;
    c.owed_scaled = 0;
    c.last_distribute_at = Clock::get()?.unix_timestamp.max(charter_closes_at);
    c.sales_stopped_at = 0;
    c.sweep_stopped_at = 0;
    c.pending_swap_operator = Pubkey::default();
    c.pending_swap_operator_at = 0;
    c.monthly_secs = monthly_secs;
    c.pending_guardian = Pubkey::default();
    c.pending_guardian_set = false;
    c.pending_guardian_at = 0;
    c.notice_secs = notice_secs;
    c.sweep_floor_lamports = sweep_floor_lamports;
    c.cooldown_ceiling_secs = cooldown_ceiling_secs;
    c.reserve_ceiling_lamports = reserve_ceiling_lamports;
    c.dist_epoch = 0;
    c.pending_count = 0;
    c.pending_this_epoch = 0;
    c.cbob_mint = ctx.accounts.cbob_mint.key();
    c.max_boost_weight = max_boost_weight;
    c.max_boost_epochs = max_boost_epochs;
    c.boost_price = 0;
    c.boost_weight = 0;
    c.boost_epochs = 0;
    c.boosts_active = 0;
    c.boosts_due = 0;
    c.boost_weight_total = 0;
    c.cbob_burned_total = 0;
    c.boost_expiring = [0; BOOST_RING];
```

Let me look at `claim_charter_vault` very carefully:

```rust
pub fn claim_charter_vault<'info>(...) -> Result<()> {
    let n_extra = pob_extra as usize;
    require!(n_extra <= MAX_POB_EXTRA && n_extra <= ctx.remaining_accounts.len(), MintError::BadPobExtra);
    let (extra, crank_accts) = ctx.remaining_accounts.split_at(n_extra);
    ...
    require!(now < cfg.charter_closes_at, MintError::CharterClosed);
    // No round check - charter claims don't need a round
    
    let cfg = &ctx.accounts.config;
    let now = Clock::get()?.unix_timestamp;
    require!(now >= cfg.charter_opens_at, MintError::CharterNotOpen);
    require!(now < cfg.charter_closes_at, MintError::CharterClosed);
    check_supply(cfg)?;
    
    check_attributes(&attributes, MAX_ATTRS - 2)?;
    
    // PoB checks
    let pob = ctx.accounts.pob_asset.key();
    {
        let a = &ctx.accounts.pob_asset;
        require_keys_eq!(*a.owner, MPL_CORE_ID, MintError::NotAProofOfBurn);
        let d = a.try_borrow_data()?;
        require!(d.len() >= 66 && d[0] == KEY_ASSET_V1, MintError::NotAProofOfBurn);
        let mut o = [0u8; 32]; o.copy_from_slice(&d[1..33]);
        require_keys_eq!(Pubkey::new_from_array(o), ctx.accounts.owner.key(), MintError::NotThePobOwner);
        require!(d[33] == UA_DISC_COLLECTION, MintError::NotAProofOfBurn);
        let mut c = [0u8; 32]; c.copy_from_slice(&d[34..66]);
        require_keys_eq!(Pubkey::new_from_array(c), cfg.pob_collection, MintError::NotAProofOfBurn);
    }
    require_keys_eq!(ctx.accounts.pob_collection.key(), cfg.pob_collection, MintError::NotAProofOfBurn);
    require!(pob_proof.len() <= MAX_POB_PROOF, MintError::PobProofTooLong);
    require!(merkle_root_from(merkle_leaf(&pob), &pob_proof) == cfg.pob_root, MintError::NotInPobSet);
```

Wait - I notice the merkle verification. Let me check the merkle function carefully:

```rust
fn merkle_leaf(key: &Pubkey) -> [u8; 32] {
    hashv(&[&[MERKLE_LEAF_TAG], key.as_ref()]).to_bytes()
}

fn merkle_root_from(mut node: [u8; 32], proof: &[[u8; 32]]) -> [u8; 32] {
    for sib in proof.iter() {
        node = if node <= *sib {
            hashv(&[&[MERKLE_NODE_TAG], &node, sib]).to_bytes()
        } else {
            hashv(&[&[MERKLE_NODE_TAG], sib, &node]).to_bytes()
        };
    }
    node
}
```

This is a Merkle tree with sorted pairs. The leaf is `sha256(0x00 || pubkey)`, and internal nodes are `sha256(0x01 || min || max)` where min/max are sorted.

Let me verify the Merkle leaf tag. Looking at scripts/pob-merkle.mjs:
```js
const leafOf = (pubkeyBytes) => H(Buffer.from([0x00]), Buffer.from(pubkeyBytes))
```
And:
```js
const nodeOf = (a, b) => Buffer.compare(a, b) <= 0
  ? H(Buffer.from([0x01]), a, b) : H(Buffer.from([0x01]), b, a)
```
Both should match.

OK let me focus on the `reveal_level` flow which is critical:

```rust
pub fn reveal_level(ctx: Context<RevealLevel>, attributes: Vec<VaultAttribute>) -> Result<()> {
    let now = Clock::get()?.slot;
    let (asset, index, reveal_slot, set, stored, hash) = {
        let r = &ctx.accounts.vault_record;
        (r.asset, r.mint_index, r.reveal_slot, r.entropy_set, r.entropy, r.attrs_hash)
    };
    require!(ctx.accounts.vault_record.level == 0, MintError::AlreadyRevealed);
    require!(index == ctx.accounts.config.revealed_total, MintError::RevealOutOfOrder);
    require_keys_eq!(ctx.accounts.asset.key(), asset, MintError::WrongAsset);
    require_keys_eq!(ctx.accounts.collection.key(), ctx.accounts.config.collection, MintError::WrongCollection);

    // NO LEVEL WITHOUT REAL ENTROPY. Captured inline here if it is still in
    // the window, and STORED so every draw stays replayable; a missed window
    // must be rescheduled first (Gary: "We can't lock everyone in the lowest level").
    let entropy: [u8; 32] = if set { stored } else {
        match try_capture(&ctx.accounts.slot_hashes.to_account_info(), reveal_slot, now, &asset)? {
            Capture::Got(e) => {
                let r = &mut ctx.accounts.vault_record;
                r.entropy = e; r.entropy_set = true;
                e
            }
            Capture::NotYet => return err!(MintError::RevealTooEarly),
            Capture::Expired => return err!(MintError::NeedsReschedule),
        }
    };
```

I need to think about what happens when:
1. The reveal slot is in the future (NotYet) - refused
3. If the window expired - it throws `NeedsReschedule`

What if the caller passed an `asset` account that is NOT the asset in the record? The check `require_keys_eq!(ctx.accounts.asset.key(), asset, MintError::WrongAsset)` ensures they match. Good.

What if `ctx.accounts.asset` is already burned? The `burned` check at the bottom:

```rust
let burned = {
    let a = &ctx.accounts.asset;
    let d = a.try_borrow_data()?;
    *a.owner == MPL_CORE_ID && d.len() == 1 && d[0] == 0
};
if !burned {
    // ... do Core update
}
```

This handles the case where the vault was burned (e.g. through a redemption) before being revealed.

Now let me look at the `pool` accumulator and check for arithmetic issues:

```rust
fn credit(c: &mut MintConfig, avail: u64, w: u64, now: i64) -> Result<()> {
    let delta = (avail as u128).checked_mul(ACC_SCALE).ok_or(MintError::Overflow)? / (w as u128);
    c.acc_scaled = c.acc_scaled.checked_add(delta).ok_or(MintError::Overflow)?;
    c.owed_scaled = c.owed_scaled.checked_add(delta.checked_mul(w as u128).ok_or(MintError::Overflow)?)
        .ok_or(MintError::Overflow)?;
    c.last_distribute_at = now;
    advance_epoch(c)
}
```

Let's verify: pool amount delta = avail / w * SCALE, and owed = delta * w.
But there's a subtle issue: the `delta` is `(avail * SCALE) / w`. Then `delta * w` is `(avail * SCALE) / w * w`. This could lose precision in the integer division if `(avail * SCALE) % w != 0`.

Wait, actually the formula is: 
- delta = (avail * SCALE) / w  (integer division, may round down)
- owed += delta * w

If (avail * SCALE) % w = r, then:
- delta = (avail * SCALE - r) / w
- delta * w = (avail * SCALE - r) * w / w = avail * SCALE - r

So the actual owed = avail * SCALE - r, where r = (avail * SCALE) % w.

The correct owed should be avail * SCALE (since each weight unit should get delta).

Wait let me re-read. The accounting works like this:
- delta = (avail * SCALE) / w (rounds down)
- owed = delta * w = avail * SCALE - (avail * SCALE % w)

So owed tracks the floor, not the ceiling. The remainder stays in the pool. This is the "dust carries" rule.

Now look at claim:
```rust
let pending = owed_of(&r, acc)?;
let pay = (pending / ACC_SCALE) as u64;
```

`owed_of`:
```rust
fn owed_of(r: &VaultRecord, acc: u128) -> Result<u128> {
    (weight_of(r)? as u128).checked_mul(acc).ok_or(MintError::Overflow)?
        .checked_add(r.carry_scaled).ok_or(MintError::Overflow)?
        .checked_sub(r.debt_scaled).ok_or(error!(MintError::Overflow))
}
```

`weight * acc` is owed. `debt_scaled` is what was already paid. So `pending = weight * acc + carry - debt`.

When we claim:
- pay = pending / SCALE (sats to pay out)
- settled = pay * SCALE (what we settle as paid)
- carry = pending - settled (sub-sat remainder)
- debt = weight * acc (reset at current weight)

So carry absorbs the dust. This should work.

Wait - there's a subtle issue here. The `debt` is reset to `weight * acc`. But what if the carry goes into the next distribution? carry is added into `pending` before debt is subtracted. So if the carry is positive, then on next claim:
- pending = (weight * acc) + carry_old - debt_old = (weight * acc) + carry_old - (weight * acc_previous)
- Which is the same as: pending = weight * acc - weight * acc_previous + carry_old

This is intended behavior. The carry preserves the sub-sat remainder.

OK let me check the retire function:
```rust
fn retire(c: &mut MintConfig, r: &mut VaultRecord, redeemed: bool, forfeit: bool) -> Result<()> {
    require!(!r.retired, MintError::AlreadyRetired);
    let mut returned: u128 = 0;
    if r.active {
        let w = weight_of(r)?;
        let full = (w as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
        let pending = owed_of(r, c.acc_scaled)?;
        if redeemed && !forfeit { require!(pending < ACC_SCALE, MintError::ClaimBeforeBurn); }
        if forfeit && pending >= ACC_SCALE {
            msg!("CBOB_REDEEMED_POOL_FROZEN asset={} forfeited_sats={}", r.asset, pending / ACC_SCALE);
        }
        c.owed_scaled = c.owed_scaled.checked_sub(pending).ok_or(MintError::Overflow)?;
        c.total_active_weight = c.total_active_weight.checked_sub(w).ok_or(MintError::Overflow)?;
        c.active_count = c.active_count.checked_sub(1).ok_or(MintError::Overflow)?;
        // A boost leaves with the vault, from wherever it is in the schedule.
        if r.boost_weight > 0 { unschedule_boost(c, r)?; }
        r.debt_scaled = full;
        r.carry_scaled = 0;
        r.active = false;
        returned = pending;
    }
    // A vault still waiting to join holds no weight and is owed nothing; it only leaves the queue.
    if r.pending {
        c.pending_count = c.pending_count.checked_sub(1).ok_or(MintError::Overflow)?;
        if r.request_epoch == c.dist_epoch {
            c.pending_this_epoch = c.pending_this_epoch.checked_sub(1).ok_or(MintError::Overflow)?;
        }
        r.pending = false;
    }
    r.retired = true;
    ...
```

Looking at this carefully:
- When retiring a redeemed vault (NOT forfeit), require `pending < ACC_SCALE` (i.e., less than 1 sat owed) - this is `ClaimBeforeBurn`.
- When forfeited (pool frozen), the undelivered share goes back to pool.
- `c.owed_scaled` decreases by `pending`.
- But `returned = pending`. The `returned_to_pool_sats` is `(returned / ACC_SCALE) as u64`.

Wait, this is interesting. The `c.owed_scaled` decreases by `pending`, but `pending` is in scaled units, not satoshis. So when a redeem happens:
- owed_scaled -= pending (scaled)
- owed_scaled now correctly reflects that the vault is no longer owed anything.

OK that's correct. The key invariant: `c.owed_scaled == sum_of_all_vault_owed_of_all_pending`.

But wait, there's an issue with the forfeit case. If forfeit=true (pool frozen), then pending is NOT required to be < ACC_SCALE, and pending >= ACC_SCALE is logged. Then owed_scaled -= pending. So the pool's owed tracking is correct.

Hmm, let me re-check the check:
```rust
if redeemed && !forfeit { require!(pending < ACC_SCALE, MintError::ClaimBeforeBurn); }
```

So `ClaimBeforeBurn` only fires when `redeemed && !forfeit`. If forfeited (pool frozen), the redeem proceeds even with owed satoshis.

Now what about when redeem happens normally (forfeit=false):
- pending must be < ACC_SCALE
- So pay must have happened first to bring pending to < ACC_SCALE
- OR the vault was never active and owed nothing

Wait but the claim must happen in the SAME transaction. Let me trace through:
1. alice claims her vault's share via `claim` (pay = pending/SCALE)
3. settle = pay * SCALE (scaled amount)
4. carry_scaled = pending - settled (sub-sat remainder)
5. debt_scaled = weight * acc (reset)

After claim:
- pending = weight * acc + carry_old - debt_old
- pay = pending / SCALE
- settled = pay * SCALE
- new_carry = pending - settled
- new_debt = weight * acc

So after claim:
- New pending = weight * acc + new_carry - new_debt = weight * acc + (pending - settled) - (weight * acc)
- = pending - settled
- = pending % SCALE (the sub-sat remainder)

So after claim, pending is < ACC_SCALE (only the sub-sat remainder).

Then when retire_redeemed is called via BURN's CPI:
- pending = sub-sat remainder (< ACC_SCALE)
- require!(pending < ACC_SCALE) ✓
- owed_scaled -= pending

Good. The sub-sat remainder is returned to the pool (it's in the owed tracking as the fraction of a sat).

Now, let me look at `distribute` more carefully:

```rust
pub fn distribute<'info>(ctx: Context<'_, '_, '_, 'info, Distribute<'info>>, burn: bool) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool_owner = ctx.accounts.config.key();
    {
        let c = &ctx.accounts.config;
        require_keys_eq!(ctx.accounts.pool_token.key(), c.pool_ata, MintError::WrongPool);
    }
    let (balance, _) = read_token(&ctx.accounts.pool_token, &ctx.accounts.config.payment_mint, &pool_owner)?;
    // Before anything, and before any $GARY is burned: a DUE boost is expired first (free, `claim`), so it never earns past the distributions it bought.
    require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst);
    let w = ctx.accounts.config.total_active_weight;
    if w == 0 {
        let c = &mut ctx.accounts.config;
        require!(waiting_to_join(c)? == 0, MintError::JoinWaitingFirst);
        require!(!burn && c.pending_this_epoch > 0, MintError::NoActiveVaults);
        require!(ctx.remaining_accounts.is_empty(), MintError::BadBurnAccounts);
        require!(now >= c.last_distribute_at.checked_add(c.monthly_secs).ok_or(MintError::Overflow)?,
            MintError::MonthNotElapsed);
        return tick(c, now);
    }
    let owed = ceil_sats(ctx.accounts.config.owed_scaled);
    let avail = balance.checked_sub(owed).ok_or(MintError::PoolShort)?;
    require!(avail > 0, MintError::NothingToDistribute);

    if burn {
        ...
        // BURN PATH
        // Check 4 accounts (burner, from, gmint, tprog)
        // Require burner's balance >= DISTRIBUTE_BURN_GARY
        // Check burner's $GARY mint, state
        // Check no waiting_to_join
        // Then SPL Burn of DISTRIBUTE_BURN_GARY
    } else {
        // FREE PATH
        // require no remaining accounts
        // require no waiting_to_join
        // require month elapsed
    }
    
    let c = &mut ctx.accounts.config;
    credit(c, avail, w, now)?;
    ...
}
```

Hmm wait, I see a potential issue. When `w == 0` AND `pending_this_epoch > 0`, the free path is taken to `tick` the epoch. But this `tick` only runs if the month has elapsed. If there are pending requests from the current epoch, but the month hasn't elapsed yet, what happens?

`return tick(c, now);` - tick() does:
```rust
fn tick(c: &mut MintConfig, now: i64) -> Result<()> {
    c.last_distribute_at = now;
    advance_epoch(c)?;
    msg!("CBOB_EPOCH_TICK epoch={} waiting={}", c.dist_epoch, c.pending_count);
    Ok(())
}
```

OK so this only fires when:
- w == 0 (no joined vaults)
- waiting_to_join == 0 (no eligible waiting vaults)
- !burn (free path only)
- pending_this_epoch > 0 (at least one vault requested this epoch)
- month has elapsed

So tick is called to advance the epoch so the pending requests become eligible. Good.

But wait - what if `w == 0`, `pending_this_epoch > 0`, AND the month has elapsed? That's the case where someone just requested activation this epoch, no one has joined, and the month is due. The tick advances the epoch. Then on the next request's epoch, waiting_to_join > 0.

Hmm. Now consider this scenario:
- At epoch 0, vault A requests activation. pending_count=1, pending_this_epoch=1.
- A month passes, distribute(false) called. tick() runs, dist_epoch=1, pending_this_epoch=0.
- At epoch 1, vault B requests activation. pending_count=1, pending_this_epoch=1.

Now waiting_to_join = pending_count - pending_this_epoch = 0.

Now distribute(false) called at epoch 1. w=0, pending_this_epoch=1, waiting_to_join=0. tick() runs, dist_epoch=2, pending_this_epoch=0.

OK so this works.

But what if at epoch 0, A requests, then epoch ticks to 1 (B at epoch 1 requests), then epoch ticks to 2. Now A and B are both eligible but not joined. pending_count=2, pending_this_epoch=0, waiting_to_join=2.

A distribute(false) at epoch 2: waiting_to_join=2, JoinWaitingFirst. Refused.

So no distribution can run until A and B are joined (which requires a claim to happen).

This looks right. The guard prevents a distributer from distributing without waiting vaults being joined first.

Hmm but what about the timing? Let me re-read:
- Join happens via `claim` when `pending` vault is named.
- pending_count is decremented, pending_this_epoch stays.
- pending->active transition in `join()`:
```rust
fn join(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    require!(r.pending && !r.active && !r.retired && c.dist_epoch > r.request_epoch, MintError::ActivationPending);
    let w = LEVEL_WEIGHTS[(r.level - 1) as usize];
    c.total_active_weight = c.total_active_weight.checked_add(w).ok_or(MintError::Overflow)?;
    c.active_count = c.active_count.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_count = c.pending_count.checked_sub(1).ok_or(MintError::Overflow)?;
    r.pending = false;
    r.active = true;
    r.debt_scaled = (w as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
    r.carry_scaled = 0;
    ...
}
```

So join requires `c.dist_epoch > r.request_epoch`. The vault joined in the epoch after its request_epoch (inclusive of the tick that made it request to join).

Wait, but distribute for the first time doesn't run on epoch 0 - it runs when the month elapses or someone burns $GARY. So at launch (epoch 0), no distribution. But a vault may request activation at epoch 0.

Let me trace:
- t=0: initialize, dist_epoch=0.
- t=30d: distribute(false) called. tick() runs, dist_epoch=1, pending_count=1->0 if request happened, else 0->0.

OK now what if the request happens at t=10d, before the month is due?
- t=10d: vault A requests activation. pending_count=1, pending_this_epoch=1.
- t=30d: distribute(false) called. w=0, waiting_to_join=0, !burn, pending_this_epoch=1, month elapsed. tick() runs, dist_epoch=1.

OK then A's request_epoch = 0 < dist_epoch = 1, so A becomes eligible. Next distribute will run.

But wait, what about `distribute(false)` BEFORE the first request? It would fail because `pending_this_epoch == 0`. Actually, the require is:
```rust
require!(!burn && c.pending_this_epoch > 0, MintError::NoActiveVaults);
```

So distribute(false) with no pending_this_epoch > 0 is refused with NoActiveVaults. The pending_count must be > 0 (since waiting_to_join handles the case of eligible-not-joined).

Now consider: at launch, no one has joined yet. A vault requests activation. pending_count=1, pending_this_epoch=1. Free path tick runs at month-end. dist_epoch=1. A is eligible (request_epoch=0 < 1).

Now distribute(burn=true) is called. waiting_to_join=1 (A is eligible but not joined). JoinWaitingFirst! Refused. The burn path doesn't burn $GARY.

OK this is consistent. The "burn path cannot open the door alone" rule works.

But wait, there's a subtle question: what if `tick()` is called with pending_this_epoch=0 but pending_count > 0? It requires pending_this_epoch > 0. So tick won't fire.

Actually this looks correct.

Let me look at the boost ring more carefully:

```rust
c.boost_expiring[i] = c.boost_expiring[i].checked_add(1).ok_or(MintError::Overflow)?;
...
c.boost_expiring[i] = c.boost_expiring[i].checked_sub(1).ok_or(MintError::Overflow)?;
```

When boost is bought:
```rust
let end = c.dist_epoch.checked_add(epochs as u64).ok_or(MintError::Overflow)?;
let i = (end % BOOST_RING as u64) as usize;
c.boost_expiring[i] = c.boost_expiring[i].checked_add(1).ok_or(MintError::Overflow)?;
```

When distribution advances epoch:
```rust
fn advance_epoch(c: &mut MintConfig) -> Result<()> {
    c.dist_epoch = c.dist_epoch.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_this_epoch = 0;
    let i = (c.dist_epoch % BOOST_RING as u64) as usize;
    c.boosts_due = c.boosts_due.checked_add(c.boost_expiring[i]).ok_or(MintError::Overflow)?;
    c.boost_expiring[i] = 0;
    Ok(())
}
```

So when epoch advances to N, the ring slot at N % 64 has its count moved to boosts_due.

But here's the issue: when boost is bought at end epoch = E, it's stored at ring slot E % 64. When the distribution after epoch E happens, dist_epoch = E + 1, so the slot (E+1) % 64 is checked.

Wait that's wrong! If the boost ends at epoch E, then when epoch becomes E+1 (the first distribution AFTER the boost's last one), the ring slot at E % 64 should be checked, but the code checks (E+1) % 64.

Wait let me re-trace. Boost starts at request, lasts N distributions. dist_epoch at request time = D. end = D + N.

When epoch advances to D+N, ring slot at (D+N) % 64 is checked. So at dist_epoch = D+N, the boost is "due".

But the boost was supposed to last N distributions starting from the NEXT one (after the request). So:
- Boost purchased at dist_epoch = D
- Should last for distributions at epochs D+1, D+2, ..., D+N

Hmm wait, the boost gives extra weight to N distributions. The first distribution that gives the extra weight is the next one after D. So:
- Dist at D+1: bonus applied, end now D+N-1
- Dist at D+2: bonus applied, end now D+N-2
- ...
- Dist at D+N: bonus applied, end now D
- Dist at D+N+1: bonus no longer applied

So end_epoch is D+N, NOT D+N-1. Wait that doesn't match.

Let me re-read the boost code:
```rust
let end = c.dist_epoch.checked_add(epochs as u64).ok_or(MintError::Overflow)?;
let i = (end % BOOST_RING as u64) as usize;
c.boost_expiring[i] = c.boost_expiring[i].checked_add(1).ok_or(MintError::Overflow)?;
```

So if boost is bought at dist_epoch=D with epochs=N, end=D+N, stored at ring slot (D+N) % 64.

`advance_epoch` adds to boosts_due when epoch becomes N where N % 64 == (D+N) % 64. So when dist_epoch reaches D+N, the boost is marked as due.

But the boost should be active for N distributions: epochs D+1, D+2, ..., D+N. That's N distributions. After dist_epoch=D+N, the boost should no longer apply.

Hmm but at dist_epoch=D+N, the advance_epoch already moved the slot (D+N) % 64 to boosts_due. The boost is now "due" but should have already been applied at D+N (the Nth distribution).

Wait let me look at the credit function more carefully. `credit` calls `advance_epoch` AT THE END. So:
- Dist at D+1: credit() called, then advance_epoch moves dist_epoch from D+1 to D+2.
- Dist at D+N: credit() called, then advance_epoch moves dist_epoch from D+N to D+N+1.

So during credit at dist_epoch=D+N, the boost is applied (its reweigh at D+N). Then advance_epoch increments to D+N+1, and adds the ring slot (D+N+1) % 64 to boosts_due.

But the boost was stored at (D+N) % 64. So advance_epoch adds (D+N+1) % 64 to boosts_due, NOT (D+N) % 64.

This is the BUG. The boost ring slot doesn't match when the boost becomes due.

Wait, let me re-read:
```rust
let end = c.dist_epoch.checked_add(epochs as u64).ok_or(MintError::Overflow)?;
let i = (end % BOOST_RING as u64) as usize;
c.boost_expiring[i] = c.boost_expiring[i].checked_add(1).ok_or(MintError::Overflow)?;
```

So if boost is bought at D with epochs=N, end=D+N, i=(D+N)%64.

When does the boost stop applying? Looking at expire_boost:
```rust
fn expire_boost(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    require!(r.boost_weight > 0 && c.dist_epoch >= r.boost_end_epoch, MintError::BoostNotDue);
    ...
}
```

So boost is expired when `c.dist_epoch >= r.boost_end_epoch`. boost_end_epoch = D+N.

And `BoostsExpireFirst`:
```rust
require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst);
```

This is in distribute, before the credit.

So the flow:
- Boost purchased at D with end=D+N. Stored at slot (D+N) % 64.
- Dist at D+1: BoostsExpireFirst checks boosts_due == 0 (yes). credit applies bonus. advance_epoch to D+2. boosts_due += slot (D+2) % 64 = 0 (assuming no other boost).
- ...
- Dist at D+N: credit applies bonus (boost is still active since dist_epoch=D+N < end=D+N). advance_epoch to D+N+1. boosts_due += slot (D+N+1) % 64 = 0.

Hmm but this never triggers the boost to be "due"! Because the slot (D+N) % 64 was never decremented back.

Wait, let me re-check. The slot was incremented when the boost was bought: ring[(D+N) % 64] += 1.

advance_epoch at D+N+1: boosts_due += ring[(D+N+1) % 64]. If no other boost ended at (D+N+1) % 64, then ring[(D+N+1) % 64] was 0, so boosts_due stays at 0.

But the boost is supposed to have ended at D+N! And it was stored at ring[(D+N) % 64], not (D+N+1) % 64. So the slot increment is NEVER undone.

This means the boost schedule gets corrupted!

Wait, let me look at unschedule_boost:
```rust
fn unschedule_boost(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    if c.dist_epoch >= r.boost_end_epoch {
        c.boosts_due = c.boosts_due.checked_sub(1).ok_or(MintError::Overflow)?;
    } else {
        let i = (r.boost_end_epoch % BOOST_RING as u64) as usize;
        c.boost_expiring[i] = c.boost_expiring[i].checked_sub(1).ok_or(MintError::Overflow)?;
    }
    c.boosts_active = c.boosts_active.checked_sub(1).ok_or(MintError::Overflow)?;
    c.boost_weight_total = c.boost_weight_total.checked_sub(r.boost_weight as u64).ok_or(MintError::Overflow)?;
    Ok(())
}
```

OK so when expire_boost is called, it calls unschedule_boost, which decrements ring[(end) % 64] OR boosts_due depending on whether the boost is due.

But the issue is: when advance_epoch runs at dist_epoch D+N+1, it doesn't check the slot for D+N! It checks (D+N+1) % 64.

Let me verify this by tracing very carefully:

Initial state: ring[(D+N) % 64] = 1, ring[(D+N+1) % 64] = 0.

Dist at D+1:
- credit() called. reweigh applies bonus. weight includes boost.
- advance_epoch() called. dist_epoch = D+2. boosts_due += ring[(D+2) % 64].
- If ring[(D+2) % 64] was 0, boosts_due stays at 0.

Dist at D+2:
- credit(). reweigh applies bonus.
- advance_epoch. dist_epoch = D+3. boosts_due += ring[(D+3) % 64] = 0.

...

Dist at D+N:
- credit(). reweigh applies bonus (boost_weight is still > 0, dist_epoch=D+N < end=D+N, so boost is active).
- advance_epoch. dist_epoch = D+N+1. boosts_due += ring[(D+N+1) % 64] = 0.

But the boost should have expired at D+N+1! And ring[(D+N) % 64] still = 1!

Dist at D+N+1:
- BoostsExpireFirst checks boosts_due == 0 (yes).
- credit() called. But boost is supposed to be expired! The boost is still active in the record (boost_weight > 0).

Hmm wait, the boost is automatically expired by claim or by the next distribute? Let me check.

Looking at `claim`:
```rust
let mut touched = false;
if r.boost_weight > 0 && ctx.accounts.config.dist_epoch >= r.boost_end_epoch {
    expire_boost(&mut ctx.accounts.config, &mut r)?;
    touched = true;
}
```

So claim auto-expires a due boost. But only if a claim is made for this vault.

But distribute doesn't auto-expire! It just credits, using the boost weight.

Let me look at the flow more carefully. At dist_epoch = D+N, the boost is "due" because dist_epoch == boost_end_epoch. But distribute happens BEFORE the expiry (BoostsExpireFirst checks but the boost hasn't been moved to due yet by advance_epoch).

Wait, when does advance_epoch move the boost to due? When dist_epoch becomes D+N+1 (the next epoch). But at that point, the distribute at D+N+1 should NOT include the boost weight.

Hmm let me re-read credit:
```rust
fn credit(c: &mut MintConfig, avail: u64, w: u64, now: i64) -> Result<()> {
    let delta = (avail as u128).checked_mul(ACC_SCALE).ok_or(MintError::Overflow)? / (w as u128);
    c.acc_scaled = c.acc_scaled.checked_add(delta).ok_or(MintError::Overflow)?;
    c.owed_scaled = c.owed_scaled.checked_add(delta.checked_mul(w as u128).ok_or(MintError::Overflow)?)
        .ok_or(MintError::Overflow)?;
    c.last_distribute_at = now;
    advance_epoch(c)
}
```

OK so credit uses w which is the TOTAL_ACTIVE_WEIGHT (which includes boost_weight). At dist_epoch = D+N+1, the boost_weight is still in the record (it hasn't been expired). So credit uses the boost weight for one more distribution!

Wait, let me trace more carefully:
- Dist at D+N:
  - BoostsExpireFirst checks boosts_due == 0. Yes (since slot at D+N % 64 still has 1, but it's not been moved to due yet).
  - credit uses total_active_weight which includes boost_weight.
  - advance_epoch to D+N+1. ring[(D+N+1) % 64] was 0, so no change.

- Dist at D+N+1:
  - BoostsExpireFirst checks boosts_due == 0. Yes.
  - credit uses total_active_weight which STILL includes boost_weight (boost not expired).
  - The boost_weight is STILL counted! Because claim hasn't been called.

This means the boost is applied for N+1 distributions, not N!

Wait actually let me look at the exact semantics more carefully. The boost is supposed to be active for N distributions. Let me check when the boost expires in the code.

Looking at `expire_boost`:
```rust
fn expire_boost(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    require!(r.boost_weight > 0 && c.dist_epoch >= r.boost_end_epoch, MintError::BoostNotDue);
    ...
}
```

So expire_boost requires `c.dist_epoch >= r.boost_end_epoch`. So at dist_epoch = boost_end_epoch = D+N, the boost is technically due. But it's only expired when someone calls expire_boost (via claim or expire_boosts instruction).

If no claim happens for this vault between D+N and D+N+1, then at D+N+1 the boost is still active.

Now in `claim`:
```rust
if r.boost_weight > 0 && ctx.accounts.config.dist_epoch >= r.boost_end_epoch {
    expire_boost(&mut ctx.accounts.config, &mut r)?;
    touched = true;
}
```

So a claim at dist_epoch = D+N+1 would expire the boost. But this claim happens AFTER the dist at D+N+1 (since distribute was at D+N+1).

So the order could be:
- Dist at D+N+1: boost still active, credit uses boosted weight, advance_epoch to D+N+2.
- Claim at D+N+2 or beyond: gets the bonus for that distribution.

But wait, the boost was supposed to be N distributions starting from D+1. So:
- D+1: bonus applied (1)
- D+2: bonus applied (2)
- ...
- D+N: bonus applied (N)

That's N distributions.

But the actual behavior is:
- D+1: bonus applied
- ...
- D+N: bonus applied
- D+N+1: bonus applied (because not yet expired!)

That's N+1 distributions.

But wait, the design says "boost is N distributions". The expected behavior is exactly N. The actual behavior is N+1?

Wait, let me re-check the expected behavior. Looking at SPEC:
> the next N distributions

So N should be exactly N. And the timing is the next N distributions.

Hmm but the implementation seems to give N+1. Unless there's something I'm missing.

Actually wait. Let me re-read advance_epoch:
```rust
fn advance_epoch(c: &mut MintConfig) -> Result<()> {
    c.dist_epoch = c.dist_epoch.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_this_epoch = 0;
    let i = (c.dist_epoch % BOOST_RING as u64) as usize;
    c.boosts_due = c.boosts_due.checked_add(c.boost_expiring[i]).ok_or(MintError::Overflow)?;
    c.boost_expiring[i] = 0;
    Ok(())
}
```

After distribute at D, advance_epoch moves dist_epoch to D+1 and checks slot (D+1) % 64. If a boost was bought at D-1 with epochs=2, then end=(D-1)+2=D+1, stored at slot (D+1) % 64. So at advance_epoch from D to D+1, the slot (D+1) % 64 is decremented.

OK so the ring is incremented when the boost is purchased, and decremented when advance_epoch advances past the end epoch.

So:
- Boost bought at D, end = D+N, slot (D+N) % 64 incremented.
- Dist at D+1: advance_epoch moves dist_epoch from D+1 to D+2. Slot (D+2) % 64 checked.
- ...
- Dist at D+N: advance_epoch moves dist_epoch from D+N to D+N+1. Slot (D+N+1) % 64 checked.

But the boost was stored at (D+N) % 64. advance_epoch never checks (D+N) % 64!

This means the slot increment is NEVER undone (except by claim/expire_boost calling unschedule_boost).

Hmm but the slot is decremented when unschedule_boost is called (if boost not yet due). And unschedule_boost is called from expire_boost (when boost is due) AND from retire (when vault is retired).

So if no claim is made for this vault, the slot increment sticks. If many boosts are bought without being claimed, the slots accumulate. This could be a bug.

But wait, the test suite has BO.16, BO.17 etc. that test this scenario. Let me think about whether the suite actually catches this.

Looking at the test code, the tests probably use the in-line monthly run or the crank to expire boosts. The crank calls `expire_boosts` periodically.

So if the crank runs between distributions, it would expire due boosts and the slots would be cleared.

But if the crank doesn't run between distributions, the slots accumulate. The next distribute may have a corrupted ring, but the slot count is wrong but boosts_due is correct (0).

Wait actually, since unschedule_boost decrements the slot or boosts_due based on whether it's due, the ring will only have "extra" counts if boosts expire via the natural mechanism (without being unscheduled first). Hmm let me re-read:

When boost is bought: ring[(end) % 64] += 1.
When advance_epoch at epoch E: boosts_due += ring[E % 64]. ring[E % 64] = 0.

So when a boost's end epoch is reached, advance_epoch will move its count from ring[end % 64] to boosts_due.

For a boost with end = D+N: at advance_epoch from D+N to D+N+1, ring[(D+N+1) % 64] is checked.

But the boost was stored at (D+N) % 64. So the advance_epoch at D+N doesn't check (D+N) % 64.

The advance_epoch at D+N+1 checks (D+N+1) % 64, not (D+N) % 64.

So the slot (D+N) % 64 is incremented when boost is bought, but never decremented by advance_epoch.

This is the bug I was suspecting!

Wait, let me re-read advance_epoch more carefully:
```rust
fn advance_epoch(c: &mut MintConfig) -> Result<()> {
    c.dist_epoch = c.dist_epoch.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_this_epoch = 0;
    let i = (c.dist_epoch % BOOST_RING as u64) as usize;
    c.boosts_due = c.boosts_due.checked_add(c.boost_expiring[i]).ok_or(MintError::Overflow)?;
    c.boost_expiring[i] = 0;
    Ok(())
}
```

After advance_epoch, dist_epoch = (was)+1.

If dist_epoch was D+1, after advance_epoch it's D+2. The slot checked is (D+2) % 64.

Hmm so the slot (D+N) % 64 is NEVER checked by advance_epoch.

Let me look at the BO.16 test in the suite to see what the test expects:

```typescript
// ROUND 24 SHIP-GATE-5 PIN (W10): the REVERSE order, [distribute, boost], in ONE
// transaction. The distribution closes epoch e first, so the boost is bought in
// e+1 and ends at e+1+N: it does NOT count the distribution before it.
{ await joinWaiting(); const p=await pool(); await top(p.w+(p.w-(p.avail%p.w))%p.w)
  const e0=(await bc()).epoch
  const rev=await att(()=>send([ixDistribute(burnBy(alice)),ixBoost(X,alice)],[alice]))
  const rx=await recB(X), c1=await bc()
  rec('BO.35','[distribute, boost] in ONE transaction land: the boost is bought in the NEW epoch and ends at e+1+N',
    `ALLOW,${e0+1n+BigInt(BE)},${e0+1n}`,`${rev.ok?'ALLOW':'REJECT'},${rx.end},${c1.epoch}`,rev.err)
  for(let i=0;i<BE;i++) await exactDist(3n)
  rec('BO.35a','...and N MORE distributions make it due, at exactly e+1+N',`1,${e0+1n+BigInt(BE)}`,`${(await bc()).due},${(await bc()).epoch}`)
  await send([ixExpire([X])],[alice]); await claimAll(LIVE2.filter(v=>v!==Q)) }
```

So the test asserts that after N distributions, the boost is "due". This means advance_epoch should move it to due after the Nth distribution.

But the test ALSO has BO.21 which says:
```typescript
{ await joinWaiting(); const p=await pool(); await top(p.w+(p.w-(p.avail%p.w))%p.w)
  const e0=(await bc()).epoch
  const one=await att(()=>send([ixBoost(X,alice),ixDistribute(burnBy(alice))],[alice]))
  const rx=await recB(X), c1=await bc()
  rec('BO.21','a boost and a distribution in ONE transaction land; the boost ends N distributions after the epoch it was bought in',
    `ALLOW,${e0+BigInt(BE)},${e0+1n}`,`${one.ok?'ALLOW':'REJECT'},${rx.end},${c1.epoch}`,one.err)
  await exactDist(3n)
  rec('BO.21a','...and ONE more makes it due: it earned exactly N (the one it rode in on counts), not N+1','1',String((await bc()).due))
  await send([ixExpire([X])],[alice]); await claimAll(LIVE2.filter(v=>v!==Q)) }
```

So BO.21 says "ONE more makes it due: it earned exactly N (the one it rode in on counts), not N+1". So the boost earns N distributions, and then becomes due at epoch e+1+N.

In this test:
- Boost X is purchased at dist_epoch = e0 with epochs = BE.
- Boost's end_epoch = e0 + BE.
- Distribution at e0+1 (in same tx as boost). The increase in epoch happens here.
- After the in-tx distribution, dist_epoch = e0+1.

Then the test calls `exactDist(3n)` ONCE more, making dist_epoch = e0+2.

The test expects (await bc()).due = 1 after 1 more distribution. So:
- After 1 more distribution (at dist_epoch = e0+2), the boost becomes due.

That means the boost should become due when dist_epoch = e0+2.

The boost end_epoch = e0+BE.

For boosts_due to be 1 at dist_epoch = e0+2, advance_epoch at e0+2 must move ring[(end+1) % 64] to due, i.e., ring[(e0+BE+1) % 64] = 1.

But the boost was stored at ring[(end) % 64] = ring[(e0+BE) % 64].

So advance_epoch at e0+2 (which is the dist_epoch AFTER credit at e0+1 which moved to e0+2, wait that's wrong)...

Hmm wait, let me trace this more carefully.

OK so the test does:
1. In one transaction: [boost(X), distribute]. The boost sets end = e0+BE, stored at ring[(e0+BE) % 64]. The distribute uses the boost weight, then advance_epoch to e0+1.

Wait but the test says "the boost is bought in the NEW epoch and ends at e+1+N" - but here the boost is bought FIRST. So the boost's "epoch it was bought in" is e0. And the distribute happens at e0 (the current epoch).

Let me re-trace:
- Before tx: dist_epoch = e0.
- Boost: end = e0 + BE, stored at ring[(e0+BE) % 64]. Boost weight applied to vault's record.
- Distribute: BoostsExpireFirst checks boosts_due == 0. credit uses total_active_weight including boost. advance_epoch to e0+1.

Now dist_epoch = e0+1.

The test calls exactDist(3n) ONCE.

exactDist(3n) does:
1. Join all pending
3. top(3n * w)
5. Call distribute(alice, false? or burn?). Let me look...

Looking at exactDist:
```typescript
const exactDist=async(k:bigint)=>{await joinWaiting(); const p=await pool(); await top(k*p.w+(p.w-(p.avail%p.w))%p.w)
  const q=await pool(); await send([ixDistribute(burnBy(alice))],[alice]); return q.avail/q.w}
```

So it calls distribute with burn. distribute(burn=true) does:
- BoostsExpireFirst check.
- credit uses total_active_weight INCLUDING boost.
- advance_epoch.

After this single exactDist, dist_epoch goes from e0+1 to e0+2.

The test then checks (await bc()).due == 1.

So at dist_epoch = e0+2, the boost should be due.

For this to work, advance_epoch at e0+2 must have moved ring[(e0+BE+1) % 64] (assuming the slot is unique) to due.

Wait, but the boost was stored at ring[(e0+BE) % 64], not (e0+BE+1) % 64.

Hmm. Let me look at the timing again. Maybe I'm miscounting.

The boost was bought at the SAME transaction as the distribute at dist_epoch = e0. The test claims:
> the boost is bought in the NEW epoch and ends at e+1+N

So the boost's "bought epoch" is the epoch after the distribute. So the boost was bought at dist_epoch = e0+1, not e0?

Wait, that doesn't make sense. The boost instruction sets end = c.dist_epoch + epochs. c.dist_epoch at the time of boost execution = e0 (since we haven't advanced yet). So end = e0 + BE.

Hmm OK so the test is saying the "NEW epoch" is the one the distribute landed at, not the original. So:
- Original epoch: e0.
- Boost bought: at dist_epoch = e0.
- Distribute happens: advance_epoch to e0+1.
- Now the "NEW epoch" is e0+1.

The boost's end is e0+BE (from dist_epoch at time of purchase).

Now the test says "ends at e+1+N" = e0+1+BE.

So the boost's effective end epoch is e0+1+BE, not e0+BE.

But the code sets end = c.dist_epoch + epochs, which is e0 + BE.

So there's a discrepancy between the test and the code!

Wait, let me re-read the test:
> '... and N MORE distributions make it due, at exactly e+1+N',`1,${e0+1n+BigInt(BE)}`

After N more distributions (starting from e0+1, so epochs e0+1, e0+2, ..., e0+N... wait, N distributions from e0+1 would be e0+1, e0+2, ..., e0+N. So after N distributions from e0+1, we reach epoch e0+N+1.

Hmm wait, "N MORE distributions" means N more distributes happen. Each distribute advances epoch by 1. So starting from dist_epoch = e0+1, after N distributes, dist_epoch = e0+1+N.

If the test does N=BE (1.6 in the suite context) distributes, and the boost is supposed to become due at that point, then advance_epoch at e0+1+BE must move ring[(e0+1+BE) % 64] to due. But the boost was stored at ring[(e0+BE) % 64].

So advance_epoch at e0+1+BE checks (e0+1+BE) % 64, not (e0+BE) % 64. These differ by 1.

Hmm there's a discrepancy.

Actually wait, maybe I miscounted the test. Let me re-read:

```typescript
for(let i=0;i<BE;i++) await exactDist(3n)
```

This runs BE times. BE = the epochs value of the boost. So it runs BE more distributes.

After BE more distributes from e0+1: dist_epoch = e0+1+BE.

So at dist_epoch = e0+1+BE, the boost should be due. advance_epoch should have moved it.

For advance_epoch to move it, the slot (e0+1+BE) % 64 must have been incremented.

But the boost was stored at (e0+BE) % 64 (when bought at dist_epoch = e0).

So slot (e0+BE) % 64 has +1, slot (e0+1+BE) % 64 has 0.

After BE distributes starting from e0+1, advance_epoch is called BE times, each time checking slot (current_dist_epoch) % 64.

After 1st distribute (from e0+1): advance_epoch to e0+2. slot (e0+2) % 64 checked.
After 2nd: to e0+3. slot (e0+3) % 64 checked.
...
After Nth: to e0+1+N. slot (e0+1+N) % 64 checked.

But the boost is at (e0+BE) % 64, not (e0+1+BE) % 64.

So the slot (e0+BE) % 64 was incremented but never decremented. The slot (e0+1+BE) % 64 was never touched.

This means the test BO.35 should FAIL on the assert `(await bc()).due == 1` (it would be 0 because the boost was never moved to due).

But the test PASSES (it's part of the suite). So either:
1. I'm misreading the code.
2. The test is wrong but happens to pass for some reason.
3. The test setup is different from what I'm assuming.

Let me look at the actual code in BOOST ring slot to understand the timing again.

In `boost_vault`:
```rust
let end = c.dist_epoch.checked_add(epochs as u64).ok_or(MintError::Overflow)?;
let i = (end % BOOST_RING as u64) as usize;
c.boost_expiring[i] = c.boost_expiring[i].checked_add(1n).ok_or(MintError::Overflow)?;
```

OK so end = current_epoch + epochs, stored at end % 64.

In `advance_epoch`:
```rust
c.dist_epoch = c.dist_epoch.checked_add(1).ok_or(MintError::Overflow)?;
c.pending_this_epoch = 0;
let i = (c.dist_epoch % BOOST_RING as u64) as usize;
c.boosts_due = c.boosts_due.checked_add(c.boost_expiring[i]).ok_or(MintError::Overflow)?;
c.boost_expiring[i] = 0;
```

After advance_epoch, dist_epoch = (was)+1. Slot checked is (was+1) % 64.

Hmm. So if boost is bought at dist_epoch = 5 with epochs = 3, end = 8, slot (8) % 64 = 8.

Distributions:
- At dist_epoch = 5: boost bought, end = 8. Slot 8 incremented.
- Dist at dist_epoch = 6: credit, advance_epoch to 7. Slot (7) % 64 checked.
- Dist at dist_epoch = 7: credit, advance_epoch to 8. Slot (8) % 64 checked. (At this point, boost slot 8 is moved to due.)

Wait! So the slot is checked at advance_epoch WHEN IT REACHES THE SLOT.

Let me re-trace. When advance_epoch is called, dist_epoch becomes (was+1). The slot checked is the NEW (was+1) % 64.

So:
- advance_epoch from 5 to 6: slot (6) % 64 checked.
- advance_epoch from 6 to 7: slot (7) % 64 checked.
- advance_epoch from 7 to 8: slot (8) % 64 checked. (Slot 8 moved to due.)

So when dist_epoch becomes 8, the boost slot 8 is moved to due.

Hmm so the boost becomes due at dist_epoch = 8.

Now when does the boost actually stop applying? When expire_boost is called.

When is expire_boost called?
1. In `claim`, when boost_weight > 0 && dist_epoch >= boost_end_epoch.
2. In `expire_boosts` instruction.

So at dist_epoch = 8 (when slot 8 is moved to due), if a claim happens, expire_boost is called, boost_weight becomes 0, slot 8 was already decremented by advance_epoch (and moved to due).

OK so the boost applies for:
- Dist at dist_epoch = 5: does the boost apply? The boost was bought at this epoch. Was credit applied at dist_epoch 5? No, because the boost was bought in the SAME transaction as the distribute.

Hmm wait let me look at the test again:
```typescript
const rev=await att(()=>send([ixDistribute(burnBy(alice)),ixBoost(X,alice)],[alice]))
```

The order in this tx is: distribute, then boost. So distribute at dist_epoch = e0, advance to e0+1. Then boost at dist_epoch = e0+1 (now), end = (e0+1) + BE, slot (e0+1+BE) % 64 incremented.

So boost bought at e0+1. Now slot (e0+1+BE) % 64 incremented.

When does it become due?
- Dist at e0+2: advance to e0+3. Slot (e0+3) % 64 checked.
- ...
- Dist at e0+1+BE: advance to e0+1+BE+1. Slot (e0+1+BE+1) % 64 checked. NOT (e0+1+BE) % 64.

Hmm still off by 1.

Wait actually let me re-read the advance_epoch more carefully:

```rust
fn advance_epoch(c: &mut MintConfig) -> Result<()> {
    c.dist_epoch = c.dist_epoch.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_this_epoch = 0;
    let i = (c.dist_epoch % BOOST_RING as u64) as usize;
    c.boosts_due = c.boosts_due.checked_add(c.boost_expiring[i]).ok_or(MintError::Overflow)?;
    c.boost_expiring[i] = 0;
    Ok(())
}
```

After advance_epoch, dist_epoch = (was)+1. Slot checked is (was+1) % 64.

So if I want to check slot X, I need to call it when the previous dist_epoch was X-1, i.e., when (was+1) == X.

For the boost to be moved to due at slot X, I need:
- A boost was bought with end = X (so slot X incremented).
- After advance_epoch brings dist_epoch to X, slot X is checked.

OK so the boost becomes due at advance_epoch that brings dist_epoch to X (= boost_end).

So if a boost is bought at epoch Y with epochs N, end = Y+N, slot (Y+N) % 64. The boost becomes due at advance_epoch bringing dist_epoch from Y+N to Y+N+1? No wait, the slot (Y+N) % 64 is checked when (was+1) = Y+N, i.e., was = Y+N-1.

So after a distribute at dist_epoch = Y+N-1, advance_epoch to Y+N, slot (Y+N) % 64 checked.

At that point, boost is due.

But the boost was active for what distributions?
- Dist at Y+1: boost applied
- Dist at Y+2: boost applied
- ...
- Dist at Y+N-1: boost applied
- Dist at Y+N: boost applied (boost_weight still > 0, dist_epoch == end_epoch == Y+N, so still active)
- Dist at Y+N+1: BoostsExpireFirst check (boosts_due = 1), so REFUSED.

So the boost is applied for N+1 distributions: Y+1 through Y+N.

Hmm so it's N+1 distributions, not N.

But the design says N distributions. The test BO.21 expects exactly N (the one it rode in on counts). Hmm.

Wait actually let me re-read the test:
```typescript
rec('BO.21','a boost and a distribution in ONE transaction land; the boost ends N distributions after the epoch it was bought in',
  `ALLOW,${e0+BigInt(BE)},${e0+1n}`,`${one.ok?'ALLOW':'REJECT'},${rx.end},${c1.epoch}`,one.err)
```

The expected rx.end = e0 + BE. So the boost's end is at e0 + BE. The "boost was bought in epoch e0" (the epoch BEFORE the distribute advanced it).

So boost bought at e0, end = e0+BE, slot (e0+BE) % 64.

When does it become due?
- Advance_epoch bringing dist_epoch to e0+BE, slot (e0+BE) % 64 checked.

So at dist_epoch = e0+BE, boost is due.

Distributions:
- Dist at e0: this is the in-tx distribute (BEFORE boost). So the boost is not yet active.
- Dist at e0+1: this is the FIRST distribution where boost applies. The test calls exactDist(3n) which does distribute(burn=true) which calls advance_epoch.
- ...

Hmm wait the in-tx distribute happens at dist_epoch = e0 (BEFORE the boost). So that distribute uses total_active_weight WITHOUT the boost.

Then at dist_epoch = e0+1 (after the in-tx distribute), the boost is applied to X's record but X is already at weight of its level. Now X's record has boost_weight = 2. But X is already joined, so X's contribution to total_active_weight includes the boost.

But wait, distribute uses total_active_weight BEFORE the advance_epoch. So at dist_epoch = e0+1 (before any distribute at this epoch), total_active_weight includes the boost.

Actually wait, the in-tx distribute was at e0 BEFORE boost. After that distribute, dist_epoch = e0+1 (advance_epoch). Then boost at e0+1.

So at e0+1, boost is in effect. But no distribute happens at e0+1 in the test (no call). Then exactDist(3n) is called, which is the 1st distribute AFTER the in-tx.

Wait no, the test calls `for(let i=0;i<BE;i++) await exactDist(3n)`. So exactDist is called BE times. But the in-tx distribute is separate (it's the one in the test's send call).

So after the in-tx:
- Dist_epoch = e0+1. Boost active.

Then for each of N iterations:
- exactDist does a distribute, advances epoch.
- After all N iterations: dist_epoch = e0+1+N.

The test asserts (await bc()).due == 1 after this loop.

So at dist_epoch = e0+1+N, the boost should be due.

For this to work, advance_epoch at e0+1+N must check slot (e0+1+N) % 64.

But the boost was stored at slot (e0+BE) % 64 (since boost bought at dist_epoch = e0, end = e0+BE).

Wait, the boost was bought at the END of the in-tx distribute. At that point, dist_epoch had ALREADY advanced to e0+1. So boost bought at dist_epoch = e0+1, end = (e0+1) + BE = e0+1+BE.

So slot (e0+1+BE) % 64 incremented.

When does it become due? When advance_epoch brings dist_epoch to (e0+1+BE), i.e., when was = e0+BE.

After BE exactDists starting from e0+1: dist_epoch = e0+1+BE. So advance_epoch at the last distribute checks slot (e0+1+BE) % 64... wait no.

Let me carefully think about this. The test is:
```typescript
for(let i=0;i<BE;i++) await exactDist(3n)
```

The first exactDist:
- Dist at dist_epoch = e0+1 (before any dist at this epoch). credit uses boost. advance_epoch to e0+2.
- The slot checked was (e0+2) % 64.

The second exactDist:
- Dist at dist_epoch = e0+2. credit uses boost. advance_epoch to e0+3.
- Slot (e0+3) % 64.

...

The BE-th exactDist:
- Dist at dist_epoch = e0+BE. credit uses boost. advance_epoch to e0+1+BE.
- Slot (e0+1+BE) % 64.

So after all BE exactDists, dist_epoch = e0+1+BE. The last slot was (e0+1+BE) % 64.

But the boost was stored at (e0+1+BE) % 64 (since bought at e0+1, end = e0+1+BE).

So at the last advance_epoch, slot (e0+1+BE) % 64 IS checked. And the boost becomes due.

Wait! So the timing works:
- Boost bought at dist_epoch = e0+1, end = e0+1+BE, stored at (e0+1+BE) % 64.
- After BE exactDists: dist_epoch = e0+1+BE. Slot (e0+1+BE) % 64 was checked on the last advance_epoch. Boost becomes due.

So the boost is applied for distributions at:
- e0+1: 1st (this is what "rounds in" - the in-tx one was BEFORE boost)
- e0+2: 2nd
- ...
- e0+BE: Nth

Wait that's only N distributions (from e0+1 to e0+BE inclusive).

Hmm wait the test BO.35 expects:
```typescript
rec('BO.35','[distribute, boost] in ONE transaction land: the boost is bought in the NEW epoch and ends at e+1+N',
  `ALLOW,${e0+1n+BigInt(BE)},${e0+1n}`,`${rev.ok?'ALLOW':'REJECT'},${rx.end},${c1.epoch}`,rev.err)
```

So when [distribute, boost] in one tx:
- Boost's end = e0+1+BE (not e0+BE).
- After: dist_epoch = e0+1.

So when boost is bought AFTER distribute, it's at dist_epoch = e0+1, end = e0+1+BE.

OK so this test confirms my understanding: when the order is [dist, boost], boost is bought at the new epoch (e0+1).

Now back to BO.21:
```typescript
{ boost_vault and a distribute in ONE transaction land; the boost ends N distributions after the epoch it was bought in
  const e0=(await bc()).epoch
  const one=await att(()=>send([ixBoost(X,alice),ixDistribute(burnBy(alice))],[alice]))
  const rx=await recB(X), c1=await bc()
  rec('BO.21',...,`ALLOW,${e0+BigInt(BE)},${e0+1n}`,`${one.ok?'ALLOW':'REJECT'},${rx.end},${c1.epoch}`,one.err)
  await exactDist(3n)
  rec('BO.21a','...and ONE more makes it due: it earned exactly N (the one it rode in on counts), not N+1','1',String((await bc()).due))
```

So:
- Boost bought BEFORE distribute.
- Boost bought at dist_epoch = e0. end = e0+BE.
- After in-tx distribute: dist_epoch = e0+1.
- Then ONE exactDist (distribute at dist_epoch = e0+1, advance to e0+2).
- Test asserts boosts_due == 1 at dist_epoch = e0+2.

For this to be true:
- After 1 exactDist from e0+1, dist_epoch = e0+2.
- The slot checked at advance_epoch from e0+1 to e0+2 was (e0+2) % 64.
- But the boost was stored at (e0+BE) % 64.

For boosts_due to be 1, the slot (e0+2) % 64 must equal the slot where the boost was stored, i.e., (e0+2) % 64 == (e0+BE) % 64. That means BE is a multiple of 64... no, that means e0+2 == e0+BE + 64k, i.e., BE == 2 + 64k.

For BE = 2 (the test value): e0+2 == e0+BE (when k=0). So slot (e0+2) % 64 == (e0+BE) % 64. The boost becomes due!

Wait this is interesting. If BE = 2, then the boost ends at e0+2. And the test calls 1 more exactDist (advance to e0+2). So at e0+2, the boost is due.

But the boost is supposed to last N=2 distributions, from e0+1 to e0+2 inclusive.

In this scenario, the boost is applied for:
- Dist at e0+1: 1st (after in-tx distribute moved to e0+1, but this exactDist is at e0+1 BEFORE distributing). Wait no.

Hmm let me re-trace carefully.

After in-tx [boost, distribute] at dist_epoch = e0:
- Boost: end = e0+BE, stored at (e0+BE) % 64. Boost applied to record.
- Distribute: credit uses total_active_weight INCLUDING boost. Advance_epoch to e0+1.

So after in-tx, dist_epoch = e0+1, boost active.

Then exactDist(3n) at top of dist_epoch = e0+1:
- Distribute: credit uses total_active_weight INCLUDING boost. Advance_epoch to e0+2.

Now dist_epoch = e0+2.

The test then checks (await bc()).due == 1.

advance_epoch from e0+1 to e0+2: slot (e0+2) % 64 checked. If (e0+BE) % 64 == (e0+2) % 64, then boost is moved to due.

For BE = 2: e0+BE = e0+2 = (e0+2). So yes, slot (e0+2) % 64 == slot (e0+BE) % 64. Boost is moved to due.

So the boost is active for ONE distribution (the one at e0+1, after the in-tx).

That's only 1 distribution, not BE=2!

Hmm. The test claims "earned exactly N (the one it rode in on counts), not N+1". So if BE=2 and the boost was applied at e0+1 only, then it earned 1 distribution. But the test says "the one it rode in on counts".

Actually wait, let me re-read: "the boost was bought in epoch e0, end = e0+BE". The boost "rode in on" which distribution?

The in-tx distribute was at dist_epoch = e0. The boost was bought AFTER that distribute. So the boost rode in on... the next distribute?

Hmm the wording is ambiguous. Let me think about what "the one it rode in on counts" means.

In BO.21 the order is [boost, distribute]. The boost is bought first, then the distribute. The test says:
- boost's end = e0 + BE
- 1 more exactDist makes it due.

So:
- In-tx distribute at e0: but wait, here the order is [boost, distribute], so boost first.

Wait the test order:
```typescript
const one=await att(()=>send([ixBoost(X,alice),ixDistribute(burnBy(alice))],[alice]))
```

OK so [boost, distribute]. Boost first, then distribute.

So in-tx:
- Boost: at dist_epoch = e0, end = e0+BE, slot (e0+BE) % 64.
- Distribute: credit uses total_active_weight INCLUDING boost (since boost is already in record). Advance_epoch to e0+1.

After in-tx, dist_epoch = e0+1, boost active.

Then exactDist(3n) at top of dist_epoch = e0+1:
- Distribute: credit uses total_active_weight INCLUDING boost. Advance_epoch to e0+2.

dist_epoch = e0+2. The slot checked at advance_epoch: (e0+2) % 64.

If (e0+BE) % 64 == (e0+2) % 64, then boost moved to due.

For BE=2: yes, since e0+BE = e0+2.

So at dist_epoch = e0+2, boost is due.

Boost was applied at: e0+1 (one exactDist). And the in-tx distribute at e0+1 was after boost was bought, so... wait the in-tx distribute was at e0, BEFORE boost was bought? No, the order is [boost, distribute], so boost first.

Wait let me re-read:
```typescript
const one=await att(()=>send([ixBoost(X,alice),ixDistribute(burnBy(alice))],[alice]))
```

[boost, distribute] in that order. Boost happens first, then distribute.

At the moment boost runs, dist_epoch = e0 (no advance since before).
After boost: end = e0+BE, boost record updated, boost applied to weight_of(X).
After distribute: credit uses total_active_weight INCLUDING boost. Advance_epoch to e0+1.

So boost applied at distribute at e0. The in-tx distribute at e0 used the boost weight!

Wait, that's a different interpretation. If the boost is bought BEFORE the distribute in the same tx, the distribute uses the boost weight.

In BO.21:
- In-tx distribute at e0 uses boost.
- exactDist(3n) at e0+1 uses boost.
- exactDist advances to e0+2. Slot (e0+2) % 64 == (e0+BE) % 64 (for BE=2). Boost becomes due.

So boost applied at:
- e0 (in-tx)
- e0+1 (exactDist)

That's 2 distributions, which is BE=2.

OK so the boost was applied for BE=2 distributions: e0 and e0+1. Then it became due at e0+2.

So the test's "the one it rode in on counts" means the distribute at e0 (the one that happened right after the boost was bought in the same tx).

So the boost counts the distribute at the SAME epoch it was bought (if it's in the same tx). That's what BO.21 is testing.

Hmm OK so the boost is counted for N distributions: from e0 (same epoch as purchase, if in same tx) through e0+N-1.

Wait that doesn't match either. Let me re-trace once more.

Boost bought at e0 (in tx, before distribute). end = e0+BE = e0+2.
Distribute at e0 (in tx, after boost): advance to e0+1. Slot (e0+1) % 64 checked. Not the boost slot.

Then 1 exactDist:
- Distribute at e0+1: credit (boost applied). advance to e0+2. Slot (e0+2) % 64 checked. This IS the boost slot. Boost becomes due.

Boost applied at:
- e0 (in-tx distribute)
- e0+1 (exactDist)

So 2 distributions, BE=2. Correct.

Now the in-tx distribute at e0 used boost. The test asserts that "the one it rode in on" counts, meaning the in-tx distribute at e0 counts.

So the design intent is: a boost purchased at epoch E counts distributions at epochs E, E+1, ..., E+N-1 (N distributions total). Then becomes due at N+N... wait that's N+1.

Wait actually no. The boost becomes due when slot (e0+BE) % 64 is checked, which happens at advance_epoch bringing dist_epoch to e0+BE.

So at dist_epoch = e0+BE, boost becomes due.

But the boost was applied at:
- e0 (in-tx)
- e0+1
- ...
- e0+BE-1

That's N distributed.

So when BE = 2, boost applied at e0 and e0+1 (2 distributions). Then becomes due at e0+2.

OK so the boost becomes due at dist_epoch = e0+BE. And it was applied for the N distributions from e0 to e0+BE-1 (inclusive).

This is consistent with "exactly N distributions".

But the test wording "and N MORE distributions make it due, at exactly e+1+N" - hmm, that suggests end at e+1+N, not e+N.

Wait, looking at the test:
```typescript
for(let i=0;i<BE;i++) await exactDist(3n)
rec('BO.35a','...and N MORE distributions make it due, at exactly e+1+N',`1,${e0+1n+BigInt(BE)}`)
```

"e+1" = e0+1 (the new epoch after the in-tx distribute).
"e+1+N" = e0+1+BE.

So the test expects boosts_due == 1 at epoch e0+1+BE.

But my trace shows it becomes due at e0+BE.

There's a discrepancy of 1 epoch.

Hmm. Let me trace once more, paying careful attention to advance_epoch:

After distribute at e0 (in-tx): advance_epoch to e0+1. Slot (e0+1) % 64 checked.

After distribute at e0+1 (1st exactDist): advance_epoch to e0+2. Slot (e0+2) % 64 checked.

...

After distribute at e0+1+BE-1 (BE-th exactDist): advance_epoch to e0+1+BE. Slot (e0+1+BE) % 64 checked.

Wait, the BE-th exactDist is at dist_epoch = e0+1+(BE-1) = e0+BE (NOT e0+1+BE).

Hmm let me recount.

Initial dist_epoch after in-tx: e0+1.

1st exactDist:
- Start: dist_epoch = e0+1.
- After distribute: dist_epoch = e0+2.

2nd exactDist:
- Start: dist_epoch = e0+2.
- After distribute: dist_epoch = e0+3.

...

N-th exactDist:
- Start: dist_epoch = e0+N.
- After distribute: dist_epoch = e0+N+1.

So after BE exactDistances, dist_epoch = e0+1+BE.

Last slot checked: at the last advance_epoch, dist_epoch went from e0+BE to e0+1+BE. Slot (e0+1+BE) % 64 checked.

But the boost was stored at (e0+BE) % 64 (since boost was bought at e0, end = e0+BE).

(e0+1+BE) % 64 != (e0+BE) % 64 (unless BE wraps).

So the boost slot (e0+BE) % 64 is NOT checked by any advance_epoch during the BE distributions. It's only checked at the (BE+1)-th distribution (which would advance to e0+1+BE+1 = e0+BE+2... but (e0+BE+2) % 64 != (e0+BE) % 64 either).

Hmm so the slot is incremented but never decremented by advance_epoch.

Let me check what the test actually expects.

Actually wait, let me re-read BO.21:
```typescript
{ await joinWaiting(); const p=await pool(); await top(p.w+(p.w-(p.avail%p.w))%p.w)
  const e0=(await bc()).epoch
  const one=await att(()=>send([ixBoost(X,alice),ixDistribute(burnBy(alice))],[alice]))
  const rx=await recB(X), c1=await bc()
  rec('BO.21','a boost and a distribution in ONE transaction land; the boost ends N distributions after the epoch it was bought in',
    `ALLOW,${e0+BigInt(BE)},${e0+1n}`,`${one.ok?'ALLOW':'REJECT'},${rx.end},${c1.epoch}`,one.err)
  await exactDist(3n)
  rec('BO.21a','...and ONE more makes it due: it earned exactly N (the one it rode in on counts), not N+1','1',String((await bc()).due))
  await send([ixExpire([X])],[alice]); await claimAll(LIVE2.filter(v=>v!==Q)) }
```

So after the in-tx, then ONE exactDist, then the test checks boosts_due == 1.

One exactDist means one distribute happens.

Initial: dist_epoch = e0.
After in-tx: dist_epoch = e0+1.
After ONE exactDist: dist_epoch = e0+2.

The test expects boosts_due == 1 at dist_epoch = e0+2.

For boosts_due == 1, the slot (e0+2) % 64 must have been incremented by the boost purchase.

Boost bought at e0, end = e0+BE = e0+2 (since BE=2 in the test).

Slot (e0+2) % 64 == (e0+BE) % 64. Yes!

So the slot (e0+2) % 64 IS the slot (e0+BE) % 64. They are the same slot!

So at advance_epoch bringing dist_epoch from e0+1 to e0+2 (during the ONE exactDist), the slot (e0+2) % 64 is checked, which is the boost slot. Boost moved to due.

So my earlier trace was wrong. Let me redo:

Boost bought at e0. end = e0+BE = e0+2. Slot (e0+2) % 64 incremented.

In-tx distribute at e0: advance to e0+1. Slot (e0+1) % 64 checked. (Not the boost slot.)

1 exactDist: distribute at e0+1, advance to e0+2. Slot (e0+2) % 64 checked. This IS the boost slot. Boost moved to due.

So at dist_epoch = e0+2, boost is due. Test expects this. 

So my concern about off-by-one was unfounded. Let me re-verify with BE=3 (one more):

Boost bought at e0. end = e0+3. Slot (e0+3) % 64 incremented.

In-tx distribute at e0: advance to e0+1. Slot (e0+1) % 64 checked.
1 exactDist: advance to e0+2. Slot (e0+2) % 64 checked.
2 exactDist: advance to e0+3. Slot (e0+3) % 64 checked. This IS the boost slot. Boost moved to due.

So after 2 exactDists, boost is due. 

OK so the timing is:
- Boost bought at epoch Y with epochs N. End = Y+N. Slot (Y+N) % 64 incremented.
- Boost is applied for distributions at epochs Y, Y+1, ..., Y+N-1 (N distributions).
- Boost becomes due at dist_epoch = Y+N (when advance_epoch brings dist_epoch to Y+N).
- Wait that's the same epoch. So at the START of the distribution at Y+N, the boost is already due (the previous advance_epoch moved it). BoostsExpireFirst would fire and refuse this distribution.

Wait but BoostsExpireFirst is checked at the START of distribute. So if a distribution at Y+N is attempted, BoostsExpireFirst refuses.

Hmm let me re-trace. The test does BE=2, and 1 exactDist after the in-tx. So:
- at in-tx distribute at e0: BoostsExpireFirst check (boosts_due=0, pass). credit uses boost. advance_epoch to e0+1. Slot (e0+1) % 64 checked. Boost not yet moved to due.
- at exactDist at e0+1: BoostsExpireFirst check (boosts_due=0, pass). credit uses boost. advance_epoch to e0+2. Slot (e0+2) % 64 checked. Boost moved to due.

So at dist_epoch = e0+2 (after the 1st exactDist), boost is due. No distribute has been attempted at e0+2 yet.

The test doesn't try a distribute at e0+2. It just checks boosts_due == 1. So the test passes.

But if a distribute WERE attempted at e0+2, BoostsExpireFirst would fire and refuse.

OK so the boost schedule works as intended. The slot calculation matches.

Let me also verify: when a distribute is refused due to BoostsExpireFirst, what happens?

Looking at distribute:
```rust
require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst);
```

It just refuses. The boost is NOT auto-expired. The caller must expire it first.

OK so the schedule works. Let me move on.

Now let me look at one more potential issue: the `expire_boosts` instruction.

Looking at `expire_boosts`:
```rust
pub fn expire_boosts<'info>(ctx: Context<'_, '_, '_, 'info, ExpireBoosts<'info>>) -> Result<()> {
    let rem = ctx.remaining_accounts;
    require!(!rem.is_empty() && rem.len() <= MAX_EXPIRE_BATCH, MintError::BadClaimList);
    let mut n = 0u32;
    for ri in rem.iter() {
        require!(ri.is_writable, MintError::BadVaultRecord);
        let mut r = load_record(ri)?;
        if r.retired || !r.active || r.boost_weight == 0 || ctx.accounts.config.dist_epoch < r.boost_end_epoch {
            continue;
        }
        expire_boost(&mut ctx.accounts.config, &mut r)?;
        store_record(ri, &r)?;
        n += 1;
    }
    msg!("CBOB_BOOSTS_EXPIRED n={} due_left={}", n, ctx.accounts.config.boosts_due);
    Ok(())
}
```

So it iterates through remaining accounts, skipping any that are retired, inactive, no boost, or boost not due. For due boosts, it calls expire_boost and stores back.

But this doesn't check that the records are valid. `load_record` does:
```rust
fn load_record(a: &AccountInfo) -> Result<VaultRecord> {
    require_keys_eq!(*a.owner, crate::ID, MintError::BadVaultRecord);
    let d = a.try_borrow_data()?;
    let r = VaultRecord::try_deserialize(&mut &d[..]).map_err(|_| error!(MintError::BadVaultRecord))?;
    require!(r.version == VAULT_RECORD_VERSION, MintError::BadVaultRecord);
    Ok(r)
}
```

This deserializes the account as a VaultRecord. So expire_boosts requires the accounts passed to be VaultRecords of this program.

What if someone passes accounts that aren't VaultRecords? `try_deserialize` would fail, and we'd get BadVaultRecord error.

OK so that's fine.

Now let me check claim's expiry of boost:
```rust
let mut touched = false;
if r.boost_weight > 0 && ctx.accounts.config.dist_epoch >= r.boost_end_epoch {
    expire_boost(&mut ctx.accounts.config, &mut r)?;
    touched = true;
}
```

This expires the boost if it's due. After this, boost_weight is 0. But the slot tracking was already updated by advance_epoch.

But wait, what about the slot increment? When boost was bought: ring[(end) % 64] += 1. When advance_epoch at end: slot is decremented, moved to boosts_due. So at this point, ring[(end) % 64] = 0 (assuming no drift). boosts_due has it.

Then claim calls unschedule_boost:
```rust
fn unschedule_boost(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    if c.dist_epoch >= r.boost_end_epoch {
        c.boosts_due = c.boosts_due.checked_sub(1).ok_or(MintError::Overflow)?;
    } else {
        let i = (r.boost_end_epoch % BOOST_RING as u64) as usize;
        c.boost_expiring[i] = c.boost_expiring[i].checked_sub(1).ok_or(MintError::Overflow)?;
    }
    ...
}
```

Since c.dist_epoch >= r.boost_end_epoch (the boost is due), it decrements boosts_due. So the count is properly removed.

OK so the boost tracking is correct as long as advance_epoch runs. If advance_epoch doesn't run, the ring slot won't be decremented.

But if advance_epoch doesn't run, then distribute doesn't run, then BoostsExpireFirst isn't checked. The slot stays incremented but no harm.

When advance_epoch finally runs (at the right time), it decrements the slot. Good.

OK so the boost tracking is correct.

Now let me look at the `claim` function more carefully.

Actually wait, the expire_boost is called in claim ONLY if dist_epoch >= boost_end_epoch. But claim can also happen BEFORE the boost is due.

If a vault has a boost and a claim happens before the boost is due, the claim should NOT expire it. And it doesn't.

But what about claim's weight calculation? `weight_of(r)` returns the boosted weight if boost exists.

```rust
fn weight_of(r: &VaultRecord) -> Result<u64> {
    require!((1..=5).contains(&r.level), MintError::NotRevealed);
    Ok(LEVEL_WEIGHTS[(r.level - 1) as usize] + r.boost_weight as u64)
}
```

So if boost_weight is 2, the total weight is level + 2. That's what I thought.

OK so the math checks out. Let me move on.

Now let me look at the charter claim window and the restricted claim implementation.

```rust
pub fn claim_charter_vault<'info>(...) -> Result<()> {
    let n_extra = pob_extra as usize;
    require!(n_extra <= MAX_POB_EXTRA && n_extra <= ctx.remaining_accounts.len(), MintError::BadPobExtra);
    let (extra, crank_accts) = ctx.remaining_accounts.split_at(n_extra);
    { let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
      monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)?; }
    let cfg = &ctx.accounts.config;
    let now = Clock::get()?.unix_timestamp;
    require!(now >= cfg.charter_opens_at, MintError::CharterNotOpen);
    require!(now < cfg.charter_closes_at, MintError::CharterClosed);
    check_supply(cfg)?;
    check_attributes(&attributes, MAX_ATTRS - 2)?;
    
    // PoB validation
    
    // burn by CPI
    ...
}
```

Hmm `monthly_inline` is called BEFORE the charter window check. So monthly inline runs regardless of charter claim status. That seems intentional.

OK now let me check the `monthly_inline` carefully:

```rust
fn monthly_inline(c: &mut MintConfig, pool: &AccountInfo, config_key: &Pubkey, now: i64) -> Result<()> {
    require_keys_eq!(pool.key(), c.pool_ata, MintError::WrongPool);
    let due = match c.last_distribute_at.checked_add(c.monthly_secs) { Some(t) => now >= t, None => false };
    if !due { return Ok(()); }
    if c.boosts_due > 0 {
        msg!("CBOB_MONTHLY_WAITS_FOR_BOOSTS due={}", c.boosts_due);
        return Ok(()); }
    if waiting_to_join(c)? > 0 {
        msg!("CBOB_MONTHLY_WAITS_FOR_JOINS waiting={}", waiting_to_join(c)?);
        return Ok(()); }
    if c.total_active_weight == 0 {
        if c.pending_this_epoch > 0 { tick(c, now)?; }
        return Ok(()); }
    if pool.owner != &SPL_TOKEN_ID { return Ok(()); }
    let balance = {
        let d = pool.try_borrow_data()?;
        if d.len() != TOKEN_ACCOUNT_LEN || d[0..32] != c.payment_mint.to_bytes() || d[32..64] != config_key.to_bytes() {
            return Ok(()); }
        if d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN { return Ok(()); }
        u64::from_le_bytes(d[64..72].try_into().unwrap())
    };
    let avail = balance.saturating_sub(ceil_sats(c.owed_scaled));
    if avail == 0 { return Ok(()); }
    let w = c.total_active_weight;
    credit(c, avail, w, now)?;
    msg!("CBOB_DISTRIBUTED amount={} path=monthly_inline", avail);
    emit!(Distributed { amount: avail, total_weight: w, active_count: c.active_count,
        acc_scaled: c.acc_scaled, burned_gary: false });
    Ok(())
}
```

Hmm OK so monthly_inline:
- If not due, return.
- If boosts due, return.
- If waiting to join, return.
- If no active weight, tick if pending this epoch, return.
- If pool account not owned by SPL Token, return (graceful degradation for not-yet-deployed pool).
- If pool data doesn't match (mismatch mint, wrong mint or wrong owner), return.
- If pool frozen, return.
- Compute avail, credit, log.

This seems correct.

But wait, there's a potential issue. monthly_inline is called from `retire_redeemed` (from BURN's CPI). At that point, the vault has been burned (asset is the tombstone) and its record is being retired. monthly_inline runs in the redemption.

The pool's balance check: `balance.saturating_sub(ceil_sats(c.owed_scaled))`. This is correct.

Now the issue: the redemption is via BURN's CPI to `retire_redeemed`. This function is called by BURN with `not_from_burn` check. If the pool's balance is wrong, monthly_inline returns early. So no problem.

But wait, what about the order: BURN's burn_vault calls retire_redeemed. retire_redeemed calls retire, then monthly_inline. The profit flows out of the vault, swept out by redeem wallet (programmatic Core Execute), then BURN checks the emptiness.

Hmm let me look at retire_redeemed again:

```rust
pub fn retire_redeemed(ctx: Context<RetireRedeemed>) -> Result<()> {
    require!(get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1, MintError::NotFromBurn);
    {
        let sysvar = ctx.accounts.instructions.to_account_info();
        let cur = load_current_index_checked(&sysvar)? as usize;
        let ix = load_instruction_at_checked(cur, &sysvar)?;
        require!(ix.program_id == BURN_PROGRAM_ID
            && ix.data.len() >= IX_BURN_VAULT_DISC.len()
            && ix.data[..IX_BURN_VAULT_DISC.len()] == IX_BURN_VAULT_DISC
            && ix.accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(ctx.accounts.asset.key()),
            MintError::NotFromBurn);
    }
    require_keys_eq!(ctx.accounts.asset.key(), ctx.accounts.vault_record.asset, MintError::WrongAsset);
    require!(is_burned(&ctx.accounts.account)?, MintError::NotBurned);
    let forfeit = pool_is_frozen(&ctx.accounts.pool_token, &ctx.accounts.config)?;
    retire(&mut ctx.accounts.config, &mut ctx.accounts.vault_record, true, forfeit)?;
    let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
    monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)
}
```

So:
1. Check stack height (top-level + 1, i.e., called via CPI from top-level).
2. Check that current instruction is BURN's burn_vault for this asset.
3. Check that asset matches vault_record.
4. Check that asset is burned.
5. Compute forfeit = pool is frozen.
6. Call retire (redeemed=true, forfeit=).
8. monthly_inline runs.

Now `pool_is_frozen`:
```rust
fn pool_is_frozen(pool: &AccountInfo, c: &MintConfig) -> Result<bool> {
    require_keys_eq!(pool.key(), c.pool_ata, MintError::WrongPool);
    if pool.owner != &SPL_TOKEN_ID { return Ok(false); }
    let d = pool.try_borrow_data()?;
    Ok(d.len() == TOKEN_ACCOUNT_LEN && d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN)
}
```

Hmm wait, this doesn't validate the pool's mint or owner. It just checks if it's a frozen SPL token account. The caller is supposed to have checked the account key. But the validation here is somewhat weak.

Actually wait, `c.pool_ata` is the MINT config's cbBTC ATA, derived at initialize. So pool.key() is checked to equal c.pool_ata. The mint/owner validation is missing here.

Hmm but if pool.key() == c.pool_ata, then the account is the right one. So the only check needed is whether it's a frozen token account.

But what if pool.key() is right but pool is not a token account? Then try_borrow_data may fail or return non-token data. If d.len() != 165, returns false (not frozen). If d.len() == 165 and state != 2, returns false.

Actually wait, `pool.owner != &SPL_TOKEN_ID { return Ok(false); }` - this returns false (not frozen) if not owned by SPL Token. So if pool is somehow not a token account, it returns false. That's defensive.

But what if pool is owned by SPL Token but has wrong mint or wrong owner? Then the mint/owner check is not done here. But since we already checked the pool's key against the expected PDA, and that PDA derives correctly, the pool IS the right one.

Actually wait, the PDA derivation `c.pool_ata` uses the canonical formula. So if pool.key() matches, pool is the MINT canonical config PDA's cbBTC ATA. By ATA derivation, pool is owned by SPL Token, has mint = c.payment_mint, and has owner = config PDA. So all checks would pass.

OK so pool_is_frozen is correct.

Let me look at the `credit` function more carefully:

```rust
fn credit(c: &mut MintConfig, avail: u64, w: u64, now: i64) -> Result<()> {
    let delta = (avail as u128).checked_mul(ACC_SCALE).ok_or(MintError::Overflow)? / (w as u128);
    c.acc_scaled = c.acc_scaled.checked_add(delta).ok_or(MintError::Overflow)?;
    c.owed_scaled = c.owed_scaled.checked_add(delta.checked_mul(w as u128).ok_or(MintError::Overflow)?)
        .ok_or(MintError::Overflow)?;
    c.last_distribute_at = now;
    advance_epoch(c)
}
```

Hmm, there's a potential issue here. `delta` could be 0 if avail < w. But we already check avail > 0 in distribute. So avail >= 1. And w >= 1 (the only way w is 0 is the early-return). So delta = avail * SCALE / w. Could be 0 if avail * SCALE < w.

Wait, delta = (avail * SCALE) / w. If avail=1 and w=1000 and SCALE=1e12, then delta = 1e12 / 1000 = 1e9.

Actually for delta to be 0, we'd need avail * SCALE < w. SCALE = 1e12. So avail < w / 1e12. For w >= 1, avail < 1e-12. Impossible since avail is u64.

Wait, avail is u64, so avail >= 1. So avail * SCALE >= 1e12. delta >= 1e12 / w. For w <= 1e12, delta >= 1. For w > 1e12, delta could be 0. But w is total_active_weight, which is sum of LEVEL_WEIGHTS (2 to 6) plus boosts. With 2100 vaults, max w = 2100 * (6+12) = 37800. So w is at most a few thousand in practice.

OK so delta >= 1e12 / few_thousand. delta is at least 1e8. So delta > 0.

OK credit is fine.

Now let me think about the `owed_scaled` update:

```rust
c.owed_scaled = c.owed_scaled.checked_add(delta.checked_mul(w as u128).ok_or(MintError::Overflow)?)
    .ok_or(MintError::Overflow)?;
```

`delta * w` is the total scaled owed. After credit, the pool "owes" this much to all vaults.

But the actual claim amount is delta * weight for each vault. So sum over all vaults of delta * weight = delta * w. Correct.

So after credit, the total owed_scaled increase equals delta * w. The bookkeeping balances.

Now let me check `claim` once more for the dust:

```rust
let pending = owed_of(&r, acc)?;
let pay = (pending / ACC_SCALE) as u64;
...
let settled = (pay as u128) * ACC_SCALE;
r.carry_scaled = pending.checked_sub(settled).ok_or(MintError::Overflow)?;
r.debt_scaled = (weight_of(&r)? as u128).checked_mul(acc).ok_or(MintError::Overflow)?;
```

So pending / SCALE = whole sats to pay. settled = pay * SCALE. carry = pending - settled (sub-sat remainder). debt = weight * acc.

So after claim, the vault's pending = weight * acc + carry - debt = carry (which is < SCALE).

So next claim's pending = weight' * acc' + carry' - debt'.

OK this is correct.

Now let me think about the boost's effect on carry.

When a vault boosts:
```rust
reweigh(c, r, extra)?;
```

reweigh:
```rust
fn reweigh(c: &mut MintConfig, r: &mut VaultRecord, boost: u8) -> Result<()> {
    require!(r.active, MintError::BoostNeedsActiveVault);
    let before = weight_of(r)?;
    let owed = owed_of(r, c.acc_scaled)?;
    r.boost_weight = boost;
    let after = weight_of(r)?;
    r.carry_scaled = owed;
    r.debt_scaled = (after as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
    c.total_active_weight = c.total_active_weight.checked_sub(before).ok_or(MintError::Overflow)?
        .checked_add(after).ok_or(MintError::Overflow)?;
    Ok(())
}
```

So reweigh:
1. Compute before weight.
2. Compute owed (weight * acc + carry - debt).
3. Set boost_weight.
4. Compute after weight.
5. Set carry = owed.
6. Set debt = after * acc.
7. Update total_active_weight.

So after reweigh, the vault's pending = after * acc + owed - after * acc = owed.

The carry holds the old pending, debt is reset to after * acc.

This means: the vault's owed share before the boost was O. After the boost, the carry preserves O, and debt is reset. So next pending = O.

So the boost doesn't add or remove owed. It just changes the rate going forward. Correct.

Hmm OK so the math is consistent.

Now let me think about a subtle issue: reweigh is called with extra = c.boost_weight, which is the global boost weight value. This is the same as r.boost_weight being set to this value.

But wait, can multiple boosts be bought over time? No, BoostActive refuses if r.boost_weight > 0. So only one boost per vault at a time.

But after the first boost expires, can another be bought? `boost_vault` checks `r.boost_weight == 0`. After expire_boost, r.boost_weight is 0. So yes, a new boost can be bought.

OK that's consistent.

Now let me look at potential issues with the rounding in `delta`:

`delta = (avail * SCALE) / w`. Integer division rounds down.

`delta * w` may not equal `avail * SCALE`. The difference is "lost" - it stays in the pool.

So after credit, the pool has: avail (in sats) - (delta * w / SCALE) in sats, which equals `avail - floor((avail * SCALE) / w) * w / SCALE` = (avail * SCALE) % w / SCALE in sats.

Wait let me redo this:
- delta = floor((avail * SCALE) / w)
- delta * w / SCALE = floor((avail * SCALE) / w) * w / SCALE

If avail * SCALE = Q*w + R where 0 <= R < w:
- delta = Q
- delta * w / SCALE = Q*w / SCALE = (avail*SCALE - R) / SCALE = avail - R/SCALE

Remaining = R / SCALE (sats in pool not distributed).

So the pool holds R/SCALE sats extra. These are owed but not yet distributed. Next credit will pick them up if there's a balance.

Actually wait, owed_scaled tracks what's owed. After credit, owed_scaled += delta * w. But the actual sats in the pool are: balance_pre + avail - paid_out.

paid_out is what gets distributed to actual vaults. paid_out = (delta * w) / SCALE (sats).

So pool balance after credit - owed_scaled / SCALE = (avail - (delta * w) / SCALE) = R / SCALE sats. This is the "dust".

Next distribute: balance_check = balance - ceil(owed_scaled / SCALE). balance is unchanged (no new revenue), owed_scaled is unchanged (no distribute happened). So avail = R / SCALE.

If R > 0, credit would be called. delta = (R * SCALE) / w. Which again, leaves (R * SCALE) % w / SCATE dust.

This is an infinite loop... actually no. After many distributions, the dust keeps accumulating. But delta is at most w, so delta * w <= w^2. And the dust reduces each round.

Actually let me think again. If the same dust (R) is split:
- delta = (R * SCALE) / w. If R < w / SCALE, then delta = 0. Then avail = 0, NothingToDistribute.

But R / SCALE is in sats, and SCALE = 1e12. R is in scaled units. R = (avail * SCALE) % w, where w is at least 1. So R could be 0 to w-1.

If avail = 1 (1 sat), then avail * SCALE = 1e12. R = (1e12) % w. If w = 7 (a single Level III vault), R = 1e12 % 7 = some small value.

delta * w = R' * w where R' is the integer division result. Actually delta = 1e12 / w (integer division), delta * w = 1e12 - R. Hmm.

OK this is getting complex. The point is, the dust stays in the pool. It's tracked by the available balance - owed_scaled.

Actually wait, the bookkeeping. After credit:
- pool balance = balance_pre + avail
- pool owed (scaled) = owed_scaled + delta * w

The pool's "undistributed" amount = balance - owed_scaled / SCALE (rounded down by ceil).

Hmm but the dust calculation isn't really an issue. The pool can hold dust sats (sub-satoshi), but those can't be represented in the pool's account (since account balance is integer sats). So dust exists conceptually as a fraction of a sat.

Actually wait, let me re-think. The pool's actual account balance is integer sats. avail = balance - ceil(owed_scaled / SCALE). So avail is integer sats.

After credit: pool balance unchanged (we just computed balance). owed_scaled += delta * w. New owed_scaled (scaled units). New avail (for next time) = balance - ceil(new owed_scaled / SCALE).

ceil(owed_scaled) = (owed_scaled + SCALE - 1) / SCALE.

OK so the bookkeeping is:
- Pool balance: integer sats.
- owed_scaled: scaled units.
- owed sats: ceil(owed_scaled / SCALE).
- avail sats: balance - owed sats.

Each credit increases owed_scaled by delta * w. If avail was N sats, then owed sats increases by (delta * w + SCALE - 1) / SCALE. Hmm.

Actually wait, let me think. avail = balance - ceil(owed_scaled / SCALE). After credit:
- New balance = balance (unchanged during credit).
- New owed_scaled = old_owed_scaled + delta * w.
- New avail = balance - ceil(new_owed_scaled / SCALE) = balance - (old_owed_scaled + delta * w + SCALE - 1) / SCALE
  = balance - ceil(old_owed_scaled/SCALE) - (delta * w + (SCALE-1 - (old_owed_scaled mod SCALE))) / SCALE

This is messy. The point is, after a credit, the new avail might not be 0 even if old avail = avail (some rounding may shift it).

Hmm. Let me trace with an example.

w = 3. SCALE = 1e12.
avail = 4 sats.
delta = 4 * 1e12 / 3 = 1333333333333 (since 4e12 / 3 = 1333333333333.33).
delta * w = 4e12. So owed_scaled += 4e12.

But avail was 4 sats. After credit, owed sats = ceil(owed_scaled / 1e12). New owed_scaled = 4e12. So new owed sats = 4.

Pool balance: unchanged. avail (new) = balance - owed sats = old_balance - 4. Hmm but old avail = balance - old owed sats = 4. So balance = old owed sats + 4.

Now new owed sats = 4. So new avail = (old owed sats + 4) - 4 = old owed sats.

Hmm so the dust didn't actually accumulate in this case. The owed sats is exactly 4.

Let me try a different example. avail = 5 sats. w = 3.
delta = 5 * 1e12 / 3 = 1666666666666 (since 5e12/3 = 1.666e12).
delta * w = 5e12. owed_scaled += 5e12.

New owed sats = ceil(5e12 / 1e12) = 5. avail new = balance - 5. Same as before.

OK so the math works out such that avail = ceil((avail * SCALE) / SCALE) * w / SCALE / SCALE = avail sats. The dust accumulates only when avail * SCALE doesn't divide evenly into w.

Hmm let me try avail = 1 sats, w = 3.
delta = 1e12 / 3 = 333333333333.
delta * w = 1e12. owed_scaled += 1e12.

New owed sats = ceil(1e12 / 1e12) = 1. avail new = balance - 1.

Same. Dust = 0.

avail = 1 sats, w = 7.
delta = 1e12 / 7 = 142857142857.
delta * w = 999999999999 (exactly 7 * 142857142857 = 999999999999).
owed_scaled += 999999999999.

New owed sats = ceil(999999999999 / 1e12) = 1. avail new = balance - 1. Same.

But what about the 1 sat? avail was 1 sat. delta*w = 999999999999 scaled = 0.999999999999 sats. So only 0.999... sats was distributed. But balance is integer sats, so we distributed 1 sat.

Hmm. The pool balance decreases by 1 sat (since claim transfers). But the bookkeeping says only 0.999999999999 sats were owed.

Wait, claim pays (pending / SCALE) = (1e12) / 1e12 = 1 sat. So yes, 1 sat is paid out.

But delta*w / SCALE = 0.999999999999. So the owed_scaled is 999999999999 (not 1e12).

So owed sats = ceil(999999999999 / 1e12) = ceil(0.999999999999) = 1.

OK so the owed sats is 1, and the pool pays out 1 sat. Balance decreases by 1 sat. 

So no dust problem for the available pool balance.

But there's a subtle thing: the sum of what each vault gets should equal delta * w (the total owed). For w = 7 vaults, each at weight 1: each vault gets delta * 1 = 142857142857 scaled = 0.142857142857 sats.

If we sum: 7 * 0.142857142857 = 0.999999999999. So total = 0.999999999999 sats.

But the pool's actual balance decreases by 1 sat (since each vault's pay was clamped to >= 1 sat, or maybe nothing was paid because pay = 0).

Wait let me re-check. For one vault:
- pending = weight * acc + carry - debt
- pay = pending / SCALE

If pending < SCALE, pay = 0. So no transfer happens. And carry stays the same.

So for w = 7 and total avail = 1 sat, each vault gets 0 (pay = 0). The pool keeps its 1 sat. The owed_scaled += 999999999999. Next distribute, owed sats = 1.

But the actual pool balance is 1 sat (unchanged). New avail = balance - ceil(owed_scaled / SCALE) = 1 - 1 = 0. NothingToDistribute.

So the pool effectively swallows 0.000000000001 sats per call, which is just a fraction. It accumulates as owed_scaled grows.

Eventually, owed_scaled reaches 1e12 - 1. Then owed sats = 1, balance = 1, avail = 0. Still nothing distributed.

After many distributions, owed_scaled grows unboundedly. Eventually it overflows u128!

Wait, but each call has avail = 0, so NothingToDistribute is returned. Nothing happens. owed_scaled doesn't grow.

Hmm but avail = balance - ceil(owed_scaled / SCALE). If balance is 1 and owed_scaled is 999999999999, then ceil = 1, avail = 0. So distribute fails.

If balance grows (more revenue), avail grows. Each distribute with avail = 1 (1 sat) does:
- delta = (1 * SCALE) / w = floor(1e12 / w).
- delta * w added to owed_scaled.

After 7 such calls (each adds about 142857142857 to owed_scaled), owed_scaled becomes 999999999999. Still ceil = 1, avail = 0.

After 8th: owed_scaled = 1142857142856. ceil = 2. avail = -1. saturating_sub: avail = 0. NothingToDistribute.

But wait, avail = balance - ceil = 1 - 2 = -1, saturated to 0. So distribute refuses.

Hmm so the pool never actually distributes in this scenario?

Wait, balance grows. If balance = 2 (after another revenue):
- avail = 2 - 1 = 1.
- credit: delta = 1e12 / 7 = 142857142857. delta * w = 999999999999. owed_scaled += 999999999999.
- New avail = 2 - 2 = 0.

So again avail = 0.

This goes on. Eventually the pool collects enough revenue to round up. But for a small pool and small avail, the dust accumulates.

Hmm let me think about whether this is a problem.

For pool with w = 7 and many small revenue events (1 sat each):
- After each event: balance += 1. ceil(owed_scaled/SCALE) = 1. avail = 0.
- Eventually balance = 7: avail = 6. credit: delta = 6e12 / 7 = 857142857142. delta*w = 5999999999994. owed_scaled += 5999999999994.

Wait, that's not right. Let me redo.

w = 7. balance = 7.
avail = 7 - 1 = 6 (since owed_scaled was 999999999999 from before, ceil = 1).
delta = 6e12 / 7 = 857142857142 (since 6e12/7 = 857142857142.857).
delta * w = 5999999999994. owed_scaled += 5999999999994.

Now owed_scaled was ~999999999999 + (some dust). Let's say it was 999999999999. Now it's 6999999999993.

ceil(6999999999999993 / 1e12) = 7. avail = 7 - 7 = 0. NothingToDistribute.

Hmm but the pool now holds 7 sats (from various revenues). The bookkeeping says owed = 7 sats. So the pool is "owed" everything it has.

But claims have not been made! Each vault's pending = weight * acc + carry - debt = 1 * 1.42857142857e12 (wait no, acc grows every credit).

Hmm. Let me think about this differently. The dust only accumulates in owed_scaled (which grows). It doesn't affect actual token balances.

Each vault's pending grows by (its share of delta * w). Its carry absorbs the sub-sats.

When the vault finally claims, pay = pending / SCALE. The carry stays. Eventually the carry is large enough that pay > 0.

OK so this is just slow distribution, not a bug.

Hmm but there's an accumulation of owed_scaled that grows. Let me check if this can overflow u128.

owed_scaled is u128. Each delta is about (avail * 1e12) / w. For avail = 1e9 (a lot) and w = 7, delta = 1e9 * 1e12 / 7 ≈ 1.4e20. Delta * w = 1e21. U128 max is about 3.4e38. So after 1e17 distributions, owed_scaled could overflow.

In practice, 1e17 distributions is 1e17 / (one per day) = 1e14 years. Not a real bug.

Now let me look at another potential issue. Let me look at `split_revenue`:

```rust
pub fn split_revenue(ctx: Context<SplitRevenue>, decimals: u8) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let (revenue, rev_bump) = Pubkey::find_program_address(&[REVENUE_SEED], &crate::ID);
    require_keys_eq!(ctx.accounts.revenue.key(), revenue, MintError::WrongTreasury);
    require_keys_eq!(ctx.accounts.mint.key(), cfg.payment_mint, MintError::WrongPaymentMint);

    let expect = |wallet: &Pubkey| Pubkey::find_program_address(
        &[wallet.as_ref(), SPL_TOKEN_ID.as_ref(), ctx.accounts.mint.key().as_ref()], &ATA_PROGRAM_ID).0;
    require_keys_eq!(ctx.accounts.revenue_ata.key(), expect(&revenue), MintError::WrongTreasury);
    require_keys_eq!(ctx.accounts.holders_ata.key(), cfg.pool_ata, MintError::WrongTreasury);
    require_keys_eq!(ctx.accounts.bank_ata.key(), expect(&cfg.bank_treasury), MintError::WrongTreasury);

    let total = {
        let d = ctx.accounts.revenue_ata.try_borrow_data()?;
        require!(d.len() >= 72, MintError::WrongTreasury);
        let mut a = [0u8; 8]; a.copy_from_slice(&d[64..72]);
        u64::from_le_bytes(a)
    };
    require!(total > 0, MintError::NothingToSplit);
    let bank_cut = ((total as u128) * ((BPS as u128) - (cfg.split_bps as u128)) / BPS as u128) as u64;
    let holders = total.checked_sub(bank_cut).ok_or(MintError::Overflow)?;

    for (amount, dest) in [(holders, &ctx.accounts.holders_ata), (bank_cut, &ctx.accounts.bank_ata)] {
        if amount == 0 { continue }
        let mut data = vec![IX_TRANSFER_CHECKED];
        data.extend_from_slice(&amount.to_le_bytes());
        data.push(decimals);
        invoke_signed(&Instruction {
            program_id: SPL_TOKEN_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.revenue_ata.key(), false),
                AccountMeta::new_readonly(ctx.accounts.mint.key(), false),
                AccountMeta::new(dest.key(), false),
                AccountMeta::new_readonly(revenue, true),
            ],
            data,
        }, &[...], &[&[REVENUE_SEED, &[rev_bump]]])?;
    }
    emit!(RevenueSplit { mint: ctx.accounts.mint.key(), total, holders, bank: bank_cut, split_bps: cfg.split_bps });
    Ok(())
}
```

So split_revenue transfers from revenue_ata to holders_ata (config pool) and bank_ata (CBOBTC Squads treasury).

bank_cut = total * (BPS - split_bps) / BPS = total * (10000 - 8500) / 10000 = total * 1500 / 10000 = total * 0.15.

For total = 100 sats: bank_cut = 15, holders = 85.

But integer math: 100 * 1500 / 10000 = 150000 / 10000 = 15. OK.
For total = 7 sats: 7 * 1500 / 10000 = 10500 / 10000 = 1 (integer). bank_cut = 1, holders = 6. Sum = 7. OK.

For total = 5 sats: 5 * 1500 / 10000 = 7500 / 10000 = 0. bank_cut = 0, holders = 5. OK (no transfer for bank_cut).

So the rounding goes to holders. Good.

Now let me think about another potential issue. In `mint_vault`:

```rust
pub fn mint_vault(ctx: Context<MintVault>, name: String, uri: String, max_price: u64,
                  attributes: Vec<VaultAttribute>) -> Result<()> {
    { let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
      monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)?; }
    let cfg = &ctx.accounts.config;
    require!(!cfg.sales_stopped, MintError::SalesStopped);
    ...
}
```

The monthly_inline runs before the sales_stopped check. So monthly_inline happens even if sales are stopped. That's intentional - monthly distribution shouldn't be gated by sales_stopped.

Now let me look at `claim`:

```rust
pub fn claim<'info>(ctx: Context<'_, '_, '_, 'info, Claim<'info>>, crank_n: u8) -> Result<()> {
    let rem = ctx.remaining_accounts;
    let k = if crank_n == 0 { 0 } else { crank_n as usize + 1 };
    require!(rem.len() >= k, MintError::BadClaimList);
    crank(&rem[..k], Clock::get()?.slot)?;
    let pairs = &rem[k..];
    require!(!pairs.is_empty() && pairs.len() % 2 == 0, MintError::BadClaimList);
    require_keys_eq!(ctx.accounts.pool_token.key(), ctx.accounts.config.pool_ata, MintError::WrongPool);
    { let key = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
      let pool = ctx.accounts.pool_token.to_account_info();
      monthly_inline(&mut ctx.accounts.config, &pool, &key, now)?; }
    let acc = ctx.accounts.config.acc_scaled;
    let bump = ctx.accounts.config.bump;
    let mut owed_paid: u128 = 0;
    let (mut paid, mut n_paid, mut n_deferred, mut n_joined) = (0u64, 0u32, 0u32, 0u32);
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
        require_keys_eq!(dest.key(), r.vault_ata, MintError::WrongVaultAccount);
        let mut touched = false;
        if r.boost_weight > 0 && ctx.accounts.config.dist_epoch >= r.boost_end_epoch {
            expire_boost(&mut ctx.accounts.config, &mut r)?;
            touched = true;
        }
        let pending = owed_of(&r, acc)?;
        let pay = (pending / ACC_SCALE) as u64;
        if pay == 0 { if touched { store_record(ri, &r)?; } continue; }
        ...
    }
```

Hmm OK so claim:
1. Run crank (if any).
2. Require pairs list.
4. Check pool account.
5. Run monthly_inline.
6. For each pair:
   a. Load record.
   b. If pending and eligible (dist_epoch > request_epoch), join and continue.
   c. If not active, skip.
   d. If boost due, expire it.
   e. Compute pending.
   f. If pay == 0, store if needed and continue.
   g. Otherwise, transfer.

OK this looks correct.

Now let me think about a subtle issue with `join` called in claim.

`join` does:
```rust
fn join(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    require!(r.pending && !r.active && !r.retired && c.dist_epoch > r.request_epoch, MintError::ActivationPending);
    let w = LEVEL_WEIGHTS[(r.level - 1) as usize];
    c.total_active_weight = c.total_active_weight.checked_add(w).ok_or(MintError::Overflow)?;
    c.active_count = c.active_count.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_count = c.pending_count.checked_sub(1).ok_or(MintError::Overflow)?;
    r.pending = false;
    r.active = true;
    r.debt_scaled = (w as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
    r.carry_scaled = 0;
    ...
}
```

So join requires `c.dist_epoch > r.request_epoch`. If equal, it doesn't join.

Now consider: a vault requests activation in epoch 0. Then the same epoch ticks (say due to monthly_inline). New epoch = 1. Vault's request_epoch = 0 < 1. So vault is eligible to join.

But join is only called via:
- The `activate` second call (after a distribution).
- `claim` naming the pending vault.

If a `claim` names the pending vault in the same epoch as the tick, and dist_epoch > request_epoch, it joins. Good.

Now consider this edge case: claim names a pending vault in the same epoch as the request. dist_epoch == request. join requires dist_epoch > request. So doesn't join. The claim loop continues. The vault stays pending.

OK so this works.

Now consider: in `crank` (the auto-crank), a claim might be sent. The crank runs AFTER each distribution. So after the tick, claim is sent. Claim's join logic should work.

But what if claim is sent WITHOUT a distribution tick? E.g., a user calls claim. Claim's join runs if dist_epoch > request_epoch. If equal, no join.

So the user must wait until after the next tick. The tick happens via distribute.

Now consider: distribute happens, advances epoch. Now claim with pending vault: joins. Good.

But what if multiple users call claim in the same epoch, all naming the pending vault? The first call joins (pending=true, then sets pending=false). The second call sees pending=false, falls through to active check, pays. But the second call's pair[0] is the same record as the first call's pair[0].

Hmm but each claim is a separate transaction, so separate records. Wait actually no, the records are loaded fresh in each call. So the second call sees pending=false (set by first call), pays.

OK that's fine.

But within a single claim, if the same vault is named twice, what happens?

In claim:
```rust
for pair in pairs.chunks(2) {
    ...
    let mut r = load_record(ri)?;
    if r.pending { ... continue; }
    if !r.active { continue; }
    ...
}
```

If the vault is named twice in the pairs:
- First iteration: load, join or process. record stored back.
- Second iteration: load FRESH from ri. (Wait, store_record happens before continue.) Hmm.

Let me trace:
- First iteration: load r. pending=true. join(c, r). store_record(ri, &r). continue.
- Second iteration: load r again (fresh from ri). r.pending is now false (stored). pending=false, skip the if. !r.active is true (r.active was just set to true). continue.

So second iteration skips. No double-pay. 

But what if the vault was active (not pending)?
- First iteration: load. active=true. compute pending, pay, store. continue.
- Second iteration: load fresh. active=true. compute pending again. pending is now 0 (paid out). pay = 0. continue (without storing).

Hmm but `touched = true` only if boost was due. In this case, the second iteration sees pending=0, pay=0, and skipped. The boost was already expired. debt_scaled was reset.

So second iteration's owed_of returns 0 (pending 0). pay = 0. Skip.

But wait, debt_scaled was reset to weight * acc in the first iteration. The second iteration sees the same debt_scaled (load reads from the account). weight * acc - debt_scaled = 0. So pending = 0. pay = 0.

But what if the second iteration happens BEFORE the first iteration's store_record? Hmm, that doesn't make sense because store_record happens before continue.

Actually let me re-read more carefully:

```rust
if r.pending {
    require_keys_eq!(dest.key(), r.vault_ata, MintError::WrongVaultAccount);
    if ctx.accounts.config.dist_epoch > r.request_epoch {
        join(&mut ctx.accounts.config, &mut r)?;
        store_record(ri, &r)?;
        n_joined += 1;
    }
    continue;
}
```

So if pending and eligible, join, store, continue. The next iteration will see updated state.

```rust
if !r.active { continue; }
require_keys_eq!(dest.key(), r.vault_ata, MintError::WrongVaultAccount);
let mut touched = false;
if r.boost_weight > 0 && ctx.accounts.config.dist_epoch >= r.boost_end_epoch {
    expire_boost(&mut ctx.accounts.config, &mut r)?;
    touched = true;
}
let pending = owed_of(&r, acc)?;
let pay = (pending / ACC_SCALE) as u64;
if pay == 0 { if touched { store_record(ri, &r)?; } continue; }
{
    ...
    // Token transfer
}
let settled = (pay as u128) * ACC_SCALE;
r.carry_scaled = pending.checked_sub(settled).ok_or(MintError::Overflow)?;
r.debt_scaled = (weight_of(&r)? as u128).checked_mul(acc).ok_or(MintError::Overflow)?;
store_record(ri, &r)?;
owed_paid = owed_paid.checked_add(settled).ok_or(MintError::Overflow)?;
paid = paid.checked_add(pay).ok_or(MintError::Overflow)?;
n_paid += 1;
```

So if active:
- Boost check.
- Compute pending, pay.
- If pay == 0, store if touched (boost was expired), continue.
- Otherwise, transfer.
- Update record.
- store_record.
- Update paid counters.

OK so each iteration loads fresh and stores. If the same vault is named twice, the first call pays, the second call sees updated state (debt 0), pay = 0, skips.

This is correct.

But wait, what about between pending and active? After join in the first iteration, r.active = true and r.pending = false. The record is stored. Second iteration loads fresh, sees r.active = true, !r.pending = true, computes pending = 0 (just joined with debt = w * acc, carry = 0). So pay = 0. Skipped.

OK that's correct.

Now let me think about the freeze check in claim:

```rust
{
    require!(dest.owner == &SPL_TOKEN_ID && dest.lamports() > 0, MintError::VaultAccountMissing);
    let d = dest.try_borrow_data()?;
    require!(d.len() == TOKEN_ACCOUNT_LEN, MintError::VaultAccountMissing);
    if d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN {
        msg!("CBOB_CLAIM_DEFERRED_FROZEN asset={} owed_sats={}", r.asset, pay);
        emit!(ClaimDeferred { asset: r.asset, owed: pay });
        n_deferred += 1;
        if touched { store_record(ri, &r)?; }
        continue;
    }
    require!(d[TOKEN_STATE_OFF] == TOKEN_STATE_INITIALIZED, MintError::VaultAccountMissing);
}
```

So if frozen:
- Log "deferred".
- Emit event.
- If boost was expired (touched), store record.
- Continue (skip the payment).

But what about the vault's pending? It stays the same (debt not reset, carry not changed). So the frozen amount can be claimed later.

But wait, the BOOST is expired (touched). So boost_weight = 0 in the stored record. The debt wasn't reset for the deferred case.

Hmm actually looking at the flow:
- If frozen and touched: only store record (with boost expired).
- If frozen and non-touched: nothing.

But the boost expiry already modified r (boost_weight=0, debt reset, etc.). So storing is needed if touched.

Hmm but if we don't store, the next claim will see boost still active. Could it be expired twice? Let me check.

unschedule_boost decrements boosts_active and ring/boosts_due. If a boost is already expired (ring slot decremented in advance_epoch), unschedule_boost decrements boosts_due.

If unschedule_boost is called twice on the same boost:
- First call: decrements ring/boosts_due.
- Second call: ring/boosts_due could underflow.

So unschedule_boost can only be called once per boost. expire_boost is what unschedule_boost is called from. expire_boost requires boost_weight > 0. After first call, boost_weight = 0. Second call would fail BoostNotDue (no boost to expire).

OK so it's safe.

Now the question: if claim finds a frozen vault and defers, and the boost was due, does the boost get expired?

Let me re-read:
```rust
let mut touched = false;
if r.boost_weight > 0 && ctx.accounts.config.dist_epoch >= r.boost_end_epoch {
    expire_boost(&mut ctx.accounts.config, &mut r)?;
    touched = true;
}
let pending = owed_of(&r, acc)?;
let pay = (pending / ACC_SCALE) as u64;
if pay == 0 { if touched { store_record(ri, &r)?; } continue; }
{
    ...
    // freeze check
    if d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN {
        ...
        if touched { store_record(ri, &r)?; }
        continue;
    }
    ...
}
```

So if frozen:
- If boost was due, touched=true. expire_boost was called. The boost is expired.
- store_record(ri, &r) stores the record with boost_weight=0.

OK so the boost IS expired even when the claim is deferred. Good.

What about the ring/boosts_due? unschedule_boost decrements these. So after expire_boost, ring or boosts_due is decremented appropriately. So the bookkeeping is correct.

Now what if the vault is frozen and the boost is NOT due? touched=false. No store. r unchanged (boost still active). Pending unchanged. pay might be 0 or > 0.

If pay == 0: skipped without storing. Same as if no boost.

If pay > 0: deferred. Skipped without storing.

Hmm so the vault is skipped (not paid), but its record is unchanged. The boost is still active.

Wait but the second check:
```rust
if pay == 0 { if touched { store_record(ri, &r)?; } continue; }
```

This says: if pay == 0, store only if touched. But what if pay == 0 AND boost was NOT due? Then no store. No change.

But what if pay == 0 AND boost IS due? Then touched=true, store.

So if boost is due AND pay is 0, the boost is still expired.

OK that's correct.

Now what if pay > 0 and boost is due? Then we go into the freeze check. If frozen: store (boost expired, pending unchanged). If NOT frozen: transfer, update pending, store.

Hmm OK so in the frozen case:
- boost expired (touched=true).
- pending unchanged.
- pay recorded as deferred.

Next claim: boost already expired (r.boost_weight = 0). Pending unchanged. If not deferred anymore (thawed), transfer.

Hmm but the pending includes the boost weight? Wait, the boost weight was applied via reweigh, which preserved owed. So owed didn't include the boost's added share, it just preserved the original owed.

Wait, that's confusing. Let me think again.

When a boost is purchased:
- Before: weight = level_weight, pending = level_weight * acc + carry - debt.
- After reweigh: boost_weight = extra. new weight = level_weight + extra. carry = pending (old owed). debt = new_weight * acc.
- After reweigh: new pending = new_weight * acc + carry - debt = new_weight * acc + pending - new_weight * acc = pending.

So pending is preserved. Good.

When boost expires (unschedule_boost + reweigh(0)):
- weight = level_weight (boost_weight = 0).
- pending (from owed_of): weight * acc + carry - debt.

Wait, before this second reweigh, debt was set to (level_weight + extra) * acc. carry was old pending.

After reweigh(0):
- weight = level_weight (no boost).
- carry = pending (from owed_of, which was old pending).
- debt = level_weight * acc.

So new pending = level_weight * acc + old pending - level_weight * acc = old pending.

Hmm so the pending is preserved across boost expiry. The boost weight only affects the RATE going forward.

So if a vault has a boost that's expired and a deferred claim, the next claim (when not frozen) gets the old pending minus the deferred amount.

Wait actually let me re-check. After boost expiry:
- r.debt_scaled = level_weight * acc (reset)
- r.carry_scaled = owed (the pending at expiry time, BEFORE the boost's contribution)

So the next pending = level_weight * acc + owed - level_weight * acc = owed.

Then if a future distribute credits the pool:
- acc grows.
- pay (at next claim) = (level_weight * acc_new + carry - debt) / SCALE.

Hmm so the boost's effect is gone, but the carry holds the old pending.

Wait this is getting confusing. Let me focus on the freeze case.

Vault has a boost (N epochs, currently at epoch >= end). Vault is frozen. Claim comes in:
- expire_boost is called (touch=true). Boost weight becomes 0. debt reset to level_weight * acc. carry holds old owed.
- pending = level_weight * acc + carry - debt = carry.
- pay = pending / SCALE. If pending >= SCALE, pay > 0.

Wait, after expire_boost:
- r.boost_weight = 0
- r.debt_scaled = level_weight * acc (reset by reweigh(0))
- r.carry_scaled = old pending (from owed_of before reweigh)

But old pending = level_weight * acc + old carry_old - old debt_old.

Let me think. Before the boost was bought:
- weight = level_weight.
- pending = level_weight * acc + carry_old - debt_old.

When boost was bought:
- reweigh(extra).
- weight = level_weight + extra.
- carry = old pending (= level_weight * acc + carry_old - debt_old).
- debt = (level_weight + extra) * acc.

Between then and now, the boost applied for N-1 distributions. Each distribution incremented acc by delta_w (the rate weighted by total_active_weight).

So acc grew. Let A_acc = current acc.

Current pending (before boost expiry) = weight * acc + carry - debt
= (level_weight + extra) * A_acc + carry - (level_weight + extra) * A_acc
= carry (unchanged since boost was bought)

So pending = carry (since boost was bought, hasn't changed much).

When boost expires:
- carry = current pending (preserved)
- debt = level_weight * A_acc (reset)
- weight = level_weight (no boost)

New pending = level_weight * A_acc + carry - debt = carry.

So pending is the same.

pay = pending / SCALE. If carry < SCALE, pay = 0. If carry >= SCALE, pay > 0.

So the frozen vault's deferred amount is whatever carry was at the time of expiry.

Hmm OK. But this means a vault's owed share is "frozen in time" if its cbBTC account is frozen.

OK let me move on to other things.

Let me look at the `claim_charter_vault` for the monthly_inline call:

```rust
{ let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
  monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)?; }
```

So monthly_inline runs first. Then charter time check. If before charter window, monthly_inline still runs.

Hmm OK.

Now let me think about the governance proposals. Let me look at `create_proposal`:

```rust
pub fn create_proposal(
    ctx: Context<CreateProposal>,
    actions: Vec<ProposalAction>,
    voting_ends_at: i64,
) -> Result<()> {
    let m = read_mint_config(&ctx.accounts.mint_config)?;
    let burned_total = read_burn_total(&ctx.accounts.burn_config)?;
    let quorum_supply = m.minted_total.checked_sub(burned_total).ok_or(GovError::BadBurnConfig)?
        .checked_sub(m.bare_retired).ok_or(GovError::BadMintConfig)?;
    let (owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
    require_keys_eq!(owner, ctx.accounts.proposer.key(), GovError::NotTheOwner);
    require_keys_eq!(collection, ctx.accounts.config.collection, GovError::ForeignVault);

    let now = Clock::get()?.unix_timestamp;
    require!(now >= m.charter_closes_at, GovError::CharterNotClosed);

    let dur = voting_ends_at.checked_sub(now).ok_or(GovError::BadWindow)?;
    require!(dur >= ctx.accounts.config.min_voting_secs && dur <= MAX_VOTING_SECS, GovError::BadWindow);

    // RULE E: a bounded list, one action per kind.
    require!(!actions.is_empty(), GovError::EmptyAction);
    require!(actions.len() <= MAX_ACTIONS, GovError::TooManyActions);
    let mut seen = [false; MAX_ACTIONS];
    // STAGE 3c: the guardian change and a new swap operator never share a
    // proposal (red-team 2 finding 2).
    let changes_guardian = actions.iter().any(|a| matches!(a, ProposalAction::Brakes { set_guardian: true, .. }));
    let arms_operator = actions.iter().any(|a| matches!(a, ProposalAction::ArmSwapOperator { .. }));
    require!(!(changes_guardian && arms_operator), GovError::KeyChangesBundled);
    for a in actions.iter() {
        let k = a.kind();
        require!(!seen[k], GovError::DuplicateAction);
        seen[k] = true;
        match a {
            ProposalAction::SetRound { opens_at, closes_at, cap, price } => {
                require!(*price >= MIN_ROUND_PRICE_SATS, GovError::PriceBelowFloor);
                require!(closes_at > opens_at, GovError::BadWindow);
                require!(closes_at.checked_sub(*opens_at).ok_or(GovError::BadWindow)? <= MAX_ROUND_SECS,
                    GovError::BadWindow);
                require!(*cap > 0, GovError::BadWindow);
            }
            ProposalAction::Brakes { restart_sales, restart_sweep, set_guardian, .. } => {
                require!(*restart_sales || *restart_sweep || *set_guardian, GovError::EmptyAction);
            }
            ProposalAction::TightenSweep(t) => {
                require!(t.sol_reserve_lamports.is_some() || t.max_sweep_lamports.is_some()
                    || t.sweep_cooldown_secs.is_some(), GovError::EmptyAction);
                if let Some(x) = t.sol_reserve_lamports { require!(x > m.sol_reserve, GovError::Loosening); }
                if let Some(x) = t.max_sweep_lamports { require!(x < m.max_sweep, GovError::Loosening); }
                if let Some(x) = t.sweep_cooldown_secs { require!(x > m.cooldown, GovError::Loosening); }
                if let Some(x) = t.sol_reserve_lamports {
                    require!(x >= RENT_EXEMPT_0_BYTES && x <= m.reserve_ceiling, GovError::TightenOutOfBounds);
                }
                if let Some(x) = t.max_sweep_lamports { require!(x >= m.sweep_floor, GovError::TightenOutOfBounds); }
                if let Some(x) = t.sweep_cooldown_secs { require!(x <= m.cooldown_ceiling, GovError::TightenOutOfBounds); }
            }
            ProposalAction::ArmSwapOperator { operator } => {
                require_keys_neq!(*operator, Pubkey::default(), GovError::EmptyAction);
            }
            ProposalAction::SetBoostTerms { price, weight, epochs } => {
                if *price > 0 {
                    require!(*weight >= 1 && *weight <= m.max_boost_weight, GovError::BoostTermsOutOfBounds);
                    require!(*epochs >= 1 && *epochs <= m.max_boost_epochs, GovError::BoostTermsOutOfBounds);
                }
            }
        }
    }
    ...
}
```

OK so create_proposal:
1. Read mint config, burn total. Compute quorum_supply.
2. Read vault asset (proposer's vault). Check proposer is owner.
3. Check vault is in our collection.
4. Check now >= charter_closes_at.
5. Check voting window bounds.
6. Check actions list.
7. Check no bundled key changes.
8. For each action, check uniqueness (after analyzing per-kind bundle).
9. For each action, check at creation time.

Hmm `MINT's tightened reserve` floor check: `x >= RENT_EXEMPT_0_BYTES`. RENT_EXEMPT_0_BYTES = 890_880. The localnet reserve could be higher than mainnet.

Wait, RENT_EXEMPT_0_BYTES = 890_880. Mainnet's is 650_240 (per the measured facts). So 890_880 > 650_240. The GOV check is `x >= 890_880`, which means x must be at least 890_880. This is conservative on mainnet (only 650_240 needed for rent exemption). OK no bug.

Now let me check execute_proposal more carefully:

```rust
pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= ctx.accounts.proposal.voting_ends_at, GovError::VotingOpen);
    require!(!ctx.accounts.proposal.executed, GovError::AlreadyExecuted);
    require!(now <= ctx.accounts.proposal.voting_ends_at
        .checked_add(EXECUTION_WINDOW_SECS).ok_or(GovError::Overflow)?, GovError::ProposalExpired);
    
    let (gov_pda, gov_bump) = Pubkey::find_program_address(&[GOV_SEED], &crate::ID);
    let m = read_mint_config(&ctx.accounts.mint_config)?;
    require_keys_eq!(m.governance, gov_pda, GovError::NotTheGovernanceAuthority);
    
    let p = &mut ctx.accounts.proposal;
    let cast = (p.yes as u128) + (p.no as u128);
    require!(cast > 0, GovError::QuorumNotMet);
    let divisor = p.quorum_supply as u128;
    let need = divisor.checked_mul(p.quorum_bps as u128).ok_or(GovError::Overflow)?
        .checked_add(9_999).ok_or(GovError::Overflow)? / 10_000u128;
    require!(need > 0, GovError::QuorumNotMet);
    require!(cast >= need, GovError::QuorumNotMet);
    let yes_bps = (p.yes as u128).checked_mul(10_000).ok_or(GovError::Overflow)? / cast;
    require!(yes_bps >= p.threshold_bps as u128, GovError::ThresholdNotMet);
    let need_yes = divisor.checked_mul(MIN_TURNOUT_YES_BPS).ok_or(GovError::Overflow)?
        .checked_add(9_999).ok_or(GovError::Overflow)? / 10_000u128;
    require!(need_yes > 0 && (p.yes as u128) >= need_yes, GovError::TurnoutTooLow);
    let key_change = p.actions.iter().any(|a| matches!(a,
        ProposalAction::Brakes { set_guardian: true, .. } | ProposalAction::ArmSwapOperator { .. }));
    if key_change {
        let need_key = divisor.checked_mul(KEY_CHANGE_YES_BPS).ok_or(GovError::Overflow)?
            .checked_add(9_999).ok_or(GovError::Overflow)? / 10_000u128;
        require!(need_key > 0 && (p.yes as u128) >= need_key, GovError::KeyChangeNeedsHalf);
    }
    
    // ORDERING, per KIND, not across the whole sequence
    ...
}
```

So:
1. Now >= voting_ends_at.
2. Not already executed.
3. Now <= voting_ends_at + 7 days.
4. Governance matches GOV PDA.
5. cast > 0.
6. cast >= quorum (need).
7. yes_bps >= threshold.
8. yes >= turnout (need_yes = 10% of divisor).
9. If key change, yes >= need_key (50% of divisor).

For quorum, threshold, and turnout calculations:
- quorum = ceil(divisor * quorum_bps / 10000)
- turnout = ceil(divisor * MIN_TURNOUT_YES_BPS / 10000) = ceil(divisor * 1000 / 10000) = ceil(divisor / 10)
- threshold = yes * 10000 / cast

Note: need > 0 check. If divisor * quorum_bps / 10000 = 0 (which means quorum_bps < divisor/10000... wait, ceil ensures it rounds up). If divisor is small enough, ceil might give 0. Hmm let me think.

Actually, ceil(Q * x / 10000) where Q is quorum_supply and x is basis points.

If divisor = 0: ceil(0) = 0. require need > 0 fails.

But quorum_supply = minted_total - burned_total - bare_retired. Could this be 0? Yes, if minted = burned + bare_retired. In that case, no live vaults. Proposal creation should fail at the proposer check (proposer must own a vault).

Hmm but what about execute_proposal? The proposer created the proposal (they must have had a vault at creation time). The proposal can be executed later. By then, the proposer's vault might have been sold/burned.

But execute_proposal doesn't check the proposer has a vault now. Just that the proposal passed.

If quorum_supply = 0 at execute time, need = 0 (with the +9999 floor thing). require need > 0 fails. So QuorumNotMet. OK that's correct.

But wait, the create_proposal snapshot quorum_supply. The execute uses p.quorum_supply. So execute uses the snapshot, not current live.

If quorum_supply at snapshot was > 0, execute uses that. Good.

But what if at snapshot, divisor * bps / 10000 rounds to 0 even though divisor > 0? Need to ensure ceil gives > 0.

ceil(Q * x / 10000) = (Q * x + 9999) / 10000. For this to be 0: Q * x + 9999 < 10000, i.e., Q * x < 1. For x >= 500 (quorum floor): Q < 1/500 = 0.002. Q is u64 >= 1 (because of > 0 check). So ceil >= 1.

Wait, but at create_proposal, quorum_supply could be 1 (if one vault live). ceil(1 * 500 / 10000) = ceil(0.05) = 1. So need = 1. 

At execute: cast >= 1. If 1 vote cast, passes. 

OK so for quorum_supply >= 1 and quorum_bps >= 500, need >= 1.

Now what about turnout: MIN_TURNOUT_YES_BPS = 1000. ceil(Q * 1000 / 10000) = ceil(Q / 10). For Q = 1: ceil(0.1) = 1. For Q = 9: ceil(0.9) = 1. For Q = 10: ceil(1) = 1. For Q = 100: ceil(10) = 10.

So turnout need is min 1, max Q/10.

And threshold: yes_bps = yes * 10000 / cast. Need yes_bps >= threshold_bps.

OK these all look correct.

Now let me check `MintConfig` struct field offsets to verify GOV's raw reads are correct.

Looking at the MintConfig layout (I need to recompute):

```rust
pub struct MintConfig {
    pub version: u8,                  // 8 (disc) + 1 = 9
    pub collection: Pubkey,             // 9 + 32 = 41
    pub governance: Pubkey,             // 41 + 32 = 73
    pub pool_ata: Pubkey,               // 73 + 32 = 105
    pub round_id: u32,                  // 105 + 4 = 109
    pub opens_at: i64,                  // 109 + 8 = 117
    pub closes_at: i64,                // 117 + 8 = 125
    pub price: u64,                     // 125 + 8 = 133
    pub cap: u32,                       // 133 + 4 = 137
    pub minted_this_round: u32,          // 137 + 4 = 141
    pub minted_total: u64,               // 141 + 8 = 149
    pub max_supply: u64,                 // 149 + 8 = 157
    pub bank_treasury: Pubkey,            // 157 + 32 = 189
    pub split_bps: u16,                 // 189 + 2 = 191
    pub sales_stopped: bool,             // 191 + 1 = 192
    pub sweep_stopped: bool,             // 192 + 1 = 193
    pub guardian: Pubkey,                // 193 + 32 = 225
    pub swap_operator: Pubkey,           // 225 + 32 = 257
    pub sol_reserve_lamports: u64,       // 257 + 8 = 265
    pub bump: u8,                       // 265 + 1 = 266
    pub max_sweep_lamports: u64,         // 266 + 8 = 274
    pub sweep_cooldown_secs: i64,       // 274 + 8 = 282
    pub last_sweep_at: i64,             // 282 + 8 = 290
    pub level_caps: [u32; 5],           // 290 + 20 = 310
    pub level_minted: [u32; 5],         // 310 + 20 = 330
    pub revealed_total: u64,             // 330 + 8 = 338
    pub payment_mint: Pubkey,            // 338 + 32 = 370
    pub pob_collection: Pubkey,           // 370 + 32 = 402
    pub pob_root: [u8; 32],             // 402 + 32 = 434
    pub charter_opens_at: i64,          // 434 + 8 = 442
    pub charter_closes_at: i64,         // 442 + 8 = 450
    pub charter_claimed: u32,           // 450 + 4 = 454
    // v6 stage 3 (version 2):
    pub bare_burns_retired: u64,         // 454 + 8 = 462
    pub total_active_weight: u64,        // 462 + 8 = 470
    pub active_count: u64,              // 470 + 8 = 478
    pub acc_scaled: u128,                // 478 + 16 = 494
    pub owed_scaled: u128,              // 494 + 16 = 510
    pub last_distribute_at: i64,        // 510 + 8 = 518
    // v6 stage 3b (version 4):
    pub sales_stopped_at: i64,           // 518 + 8 = 526
    pub sweep_stopped_at: i64,          // 526 + 8 = 534
    pub pending_swap_operator: Pubkey,   // 534 + 32 = 566
    pub pending_swap_operator_at: i64,  // 566 + 8 = 574
    pub monthly_secs: i64,              // 574 + 8 = 582
    // v6 stage 3c (version 5):
    pub pending_guardian: Pubkey,        // 582 + 32 = 614
    pub pending_guardian_set: bool,     // 614 + 1 = 615
    pub pending_guardian_at: i64,      // 615 + 8 = 623
    pub notice_secs: i64,               // 623 + 8 = 631
    pub sweep_floor_lamports: u64,     // 631 + 8 = 639
    pub cooldown_ceiling_secs: i64,     // 639 + 8 = 647
    pub reserve_ceiling_lamports: u64, // 647 + 8 = 655
    pub dist_epoch: u64,                // 655 + 8 = 663
    pub pending_count: u64,             // 663 + 8 = 671
    pub pending_this_epoch: u64,       // 671 + 8 = 679
    // v6 $CBOB boost (version 6):
    pub cbob_mint: Pubkey,             // 679 + 32 = 711
    pub max_boost_weight: u8,           // 711 + 1 = 712
    pub max_boost_epochs: u16,          // 712 + 2 = 714
    pub boost_price: u64,               // 714 + 8 = 722
    pub boost_weight: u8,               // 722 + 1 = 723
    pub boost_epochs: u16,              // 723 + 2 = 725
    pub boosts_active: u32,              // 725 + 4 = 729
    pub boosts_due: u32,                // 729 + 4 = 733
    pub boost_weight_total: u64,        // 733 + 8 = 741
    pub cbob_burned_total: u64,          // 741 + 8 = 749
    pub boost_expiring: [u32; BOOST_RING], // 749 + 4*64 = 749 + 256 = 1005
    // + CONFIG_PADDING (256)
}
```

Now let me check the offsets in GOV:
- OFF_GOVERNANCE = 41 ✓
- OFF_ROUND_ID = 105 ✓
- OFF_PRICE = 125 ✓
- OFF_MINTED_TOTAL = 141 ✓
- OFF_SALES_STOPPED = 191 ✓
- OFF_SWEEP_STOPPED = 192 ✓
- OFF_SALES_STOPPED_AT = 518 ✓
- OFF_SWEEP_STOPPED_AT = 526 ✓
- OFF_SWEEP_FLOOR = 631 ✓
- OFF_COOLDOWN_CEILING = 639 ✓
- OFF_RESERVE_CEILING = 647 ✓
- OFF_MAX_BOOST_WEIGHT = 711 ✓
- OFF_MAX_BOOST_EPOCHS = 712 ✓
- OFF_MINT_GOVERNANCE = 41 ✓
- OFF_MINT_BARE_RETIRED = 454 ✓
- OFF_MINT_CHARTER_CLOSES = 442 ✓
- OFF_MINT_SOL_RESERVE = 257 ✓
- OFF_MINT_MAX_SWEEP = 266 ✓
- OFF_MINT_COOLDOWN = 274 ✓

Wait, GOV's comment says:
> const OFF_MINT_SOL_RESERVE: usize = 257;

But the field `sol_reserve_lamports` is at offset 257 in my computation. Let me double-check:

Starting from offset 8 (after discriminator):
- 8: version (u8) - 1 byte
- 9-40: collection (Pubkey) - 32 bytes (32 bytes from 9 to 41, so 9 + 32 = 41)
- 41-72: governance (Pubkey) - 32 bytes (41 + 32 = 73)
- 73-104: pool_ata (Pubkey) - 32 bytes (73 + 32 = 105)
- 105-108: round_id (u32) - 4 bytes (105 + 4 = 109)
- 109-116: opens_at (i64) - 8 bytes (109 + 8 = 117)
- 117-124: closes_at (i64) - 8 bytes (117 + 8 = 125)
- 125-132: price (u64) - 8 bytes (125 + 8 = 133)
- 133-136: cap (u32) - 4 bytes (133 + 4 = 137)
- 137-140: minted_this_round (u32) - 4 bytes (137 + 4 = 141)
- 141-148: minted_total (u64) - 8 bytes (141 + 8 = 149)
- 149-156: max_supply (u64) - 8 bytes (149 + 8 = 157)
- 157-188: bank_treasury (Pubkey) - 32 bytes (157 + 32 = 189)
- 189-190: split_bps (u16) - 2 bytes (189 + 2 = 191)
- 191: sales_stopped (bool) - 1 byte (191 + 1 = 192)
- 192: sweep_stopped (bool) - 1 byte (192 + 1 = 193)
- 193-224: guardian (Pubkey) - 32 bytes (193 + 32 = 225)
- 225-256: swap_operator (Pubkey) - 32 bytes (225 + 32 = 257)
- 257-264: sol_reserve_lamports (u64) - 8 bytes (257 + 8 = 265)
- 265: bump (u8) - 1 byte (265 + 1 = 266)
- 266-273: max_sweep_lamports (u64) - 8 bytes (266 + 8 = 274)
- 274-281: sweep_cooldown_secs (i64) - 8 bytes (274 + 8 = 282)
- 282-289: last_sweep_at (i64) - 8 bytes (282 + 8 = 290)
- 290-309: level_caps ([u32; 5]) - 20 bytes (290 + 20 = 310)
- 310-329: level_minted ([u32; 5]) - 20 bytes (310 + 20 = 330)
- 330-337: revealed_total (u64) - 8 bytes (330 + 8 = 338)
- 338-369: payment_mint (Pubkey) - 32 bytes (338 + 32 = 370)
- 370-401: pob_collection (Pubkey) - 32 bytes (370 + 32 = 402)
- 402-433: pob_root ([u8; 32]) - 32 bytes (402 + 32 = 434)
- 434-441: charter_opens_at (i64) - 8 bytes (434 + 8 = 442)
- 442-449: charter_closes_at (i64) - 8 bytes (442 + 8 = 450)
- 450-453: charter_claimed (u32) - 4 bytes (450 + 4 = 454)
- 454-461: bare_burns_retired (u64) - 8 bytes (454 + 8 = 462)
- 462-469: total_active_weight (u64) - 8 bytes (462 + 8 = 470)
- 470-477: active_count (u64) - 8 bytes (470 + 8 = 478)
- 478-493: acc_scaled (u128) - 16 bytes (478 + 16 = 494)
- 494-509: owed_scaled (u128) - 16 bytes (494 + 16 = 510)
- 510-517: last_distribute_at (i64) - 8 bytes (510 + 8 = 518)
- 518-525: sales_stopped_at (i64) - 8 bytes (518 + 8 = 526)
- 526-533: sweep_stopped_at (i64) - 8 bytes (526 + 8 = 534)
- 534-565: pending_swap_operator (Pubkey) - 32 bytes (534 + 32 = 566)
- 566-573: pending_swap_operator_at (i64) - 8 bytes (566 + 8 = 574)
- 574-581: monthly_secs (i64) - 8 bytes (574 + 8 = 582)
- 582-613: pending_guardian (Pubkey) - 32 bytes (582 + 32 = 614)
- 614: pending_guardian_set (bool) - 1 byte (614 + 1 = 615)
- 615-622: pending_guardian_at (i64) - 8 bytes (615 + 8 = 623)
- 623-630: notice_secs (i64) - 8 bytes (623 + 8 = 631)
- 631-638: sweep_floor_lamports (u64) - 8 bytes (631 + 8 = 639)
- 639-646: cooldown_ceiling_secs (i64) - 8 bytes (639 + 8 = 647)
- 647-654: reserve_ceiling_lamports (u64) - 8 bytes (647 + 8 = 655)
- 655-662: dist_epoch (u64) - 8 bytes (655 + 8 = 663)
- 663-670: pending_count (u64) - 8 bytes (663 + 8 = 671)
- 671-678: pending_this_epoch (u64) - 8 bytes (671 + 8 = 679)
- 679-710: cbob_mint (Pubkey) - 32 bytes (679 + 32 = 711)
- 711: max_boost_weight (u8) - 1 byte (711 + 1 = 712)
- 712-713: max_boost_epochs (u16) - 2 bytes (712 + 2 = 714)
- 714-721: boost_price (u64) - 8 bytes (714 + 8 = 722)
- 722: boost_weight (u8) - 1 byte (722 + 1 = 723)
- 723-724: boost_epochs (u16) - 2 bytes (723 + 2 = 725)
- 725-728: boosts_active (u32) - 4 bytes (725 + 4 = 729)
- 729-732: boosts_due (u32) - 4 bytes (729 + 4 = 733)
- 733-740: boost_weight_total (u64) - 8 bytes (733 + 8 = 741)
- 741-748: cbob_burned_total (u64) - 8 bytes (741 + 8 = 749)
- 749-1004: boost_expiring ([u32; 64]) - 256 bytes (749 + 256 = 1005)
- 1005-1260: padding (256 bytes)

Total: 1260 + 8 = 1261? Hmm let me check the constants in MINT source:

```rust
const MINT_CONFIG_SPACE: usize = 8 + 1 + 32 * 3 + 4 + 8 * 3 + 4 + 4 + 8 * 2 + 32 + 2 + 1 + 1
    + 32 * 2 + 8 + 1 + 8 + 8 + 8
    + 8 * 5 + 8 * 5 + 8 + 32 + 32 + 32 + 8 + 8 + 4
    + 8 + 8 + 8 + 16 + 16 + 8
    + 8 + 8 + 32 + 8
    + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8
    + 32 + 1 + 2 + 8 + 1 + 2 + 4 + 4 + 8 + 8 + 4 * BOOST_RING + CONFIG_PADDING;
```

Let me parse this:
- 8 (disc)
- + 1 (version)
- + 32 * 3 (collection, governance, pool_ata)
- + 4 (round_id)
- + 8 * 3 (opens_at, closes_at, price)
- + 4 (cap)
- + 4 (minted_this_round)
- + 8 * 2 (minted_total, max_supply)
- + 32 (bank_treasury)
- + 2 (split_bps)
- + 1 (sales_stopped)
- + 1 (sweep_stopped)
- + 32 * 2 (guardian, swap_operator)
- + 8 (sol_reserve_lamports)
- + 1 (bump)
- + 8 (max_sweep_lamports)
- + 8 (sweep_cooldown_secs)
- + 8 (last_sweep_at)
- + 8 * 5 (level_caps)
- + 8 * 5 (level_minted)
- + 8 (revealed_total)
- + 32 (payment_mint)
- + 32 (pob_collection)
- + 32 (pob_root)
- + 8 (charter_opens_at)
- + 8 (charter_closes_at)
- + 4 (charter_claimed)
- + 8 (bare_burns_retired)
- + 8 (total_active_weight)
- + 8 (active_count)
- + 16 (acc_scaled)
- + 16 (owed_scaled)
- + 8 (last_distribute_at)
- + 8 (sales_stopped_at)
- + 8 (sweep_stopped_at)
- + 32 (pending_swap_operator)
- + 8 (pending_swap_operator_at)
- + 32 (pending_guardian)
- + 1 (pending_guardian_set)
- + 8 (pending_guardian_at)
- + 8 (notice_secs)
- + 8 (sweep_floor_lamports)
- + 8 (cooldown_ceiling_secs)
- + 8 (reserve_ceiling_lamports)
- + 8 (dist_epoch)
- + 8 (pending_count)
- + 8 (pending_this_epoch)
- + 32 (cbob_mint)
- + 1 (max_boost_weight)
- + 2 (max_boost_epochs)
- + 8 (boost_price)
- + 1 (boost_weight)
- + 2 (boost_epochs)
- + 4 (boosts_active)
- + 4 (boosts_due)
- + 8 (boost_weight_total)
- + 8 (cbob_burned_total)
- + 4 * BOOST_RING (boost_expiring)
- + CONFIG_PADDING

Let me add: 8 + 1 + 96 + 4 + 24 + 4 + 4 + 16 + 32 + 2 + 1 + 1 + 64 + 8 + 1 + 8 + 8 + 8 + 40 + 40 + 8 + 32 + 32 + 32 + 16 + 4 + 8 + 8 + 8 + 16 + 16 + 8 + 8 + 8 + 32 + 8 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 32 + 1 + 2 + 8 + 1 + 2 + 4 + 4 + 8 + 8 + 256 + 256.

= 8+1+96+4+24+4+4+16+32+2+1+1+64+8+1+8+8+8+40+40+8+32+32+32+16+4+8+8+8+16+16+8+8+8+32+8+32+1+8+8+8+8+8+8+8+32+1+2+8+1+2+4+4+8+8+256+256

Let me just calculate: 
8+1=9, +96=105, +4=109, +24=133, +4=137, +4=141, +16=157, +32=189, +2=191, +1=192, +1=193, +64=257, +8=265, +1=266, +32=298, +8=306, +8=314, +40=354, +40=394, +8=402, +32=434, +32=466, +32=498, +16=514, +4=518, +8=526, +8=534, +8=542, +16=558, +16=574, +8=582, +8=590, +8=598, +32=630, +8=638, +32=670, +1=671, +8=679, +8=687, +8=695, +8=703, +8=711, +8=719, +8=727, +8=735, +32=767, +1=768, +2=770, +8=778, +1=779, +2=781, +4=785, +4=789, +8=797, +8=805, +256=1061, +256=1317.

Hmm but my earlier calculation said the boost_expiring is at 749. Let me check.

Hmm actually I think I made an error. Let me recount. The order of fields after bare_burns_retired is:
- total_active_weight (u64) - 8 bytes
- active_count (u64) - 8 bytes
- acc_scaled (u128) - 16 bytes
- owed_scaled (u128) - 16 bytes
- last_distribute_at (i64) - 8 bytes
- sales_stopped_at (i64) - 8 bytes
- sweep_stopped_at (i64) - 8 bytes
- pending_swap_operator (Pubkey) - 32 bytes
- pending_swap_operator_at (i64) - 8 bytes
- monthly_secs (i64) - 8 bytes
- pending_guardian (Pubkey) - 32 bytes
- pending_guardian_set (bool) - 1 byte
- pending_guardian_at (i64) - 8 bytes
- notice_secs (i64) - 8 bytes
- sweep_floor_lamports (u64) - 8 bytes
- cooldown_ceiling_secs (i64) - 8 bytes
- reserve_ceiling_lamports (u64) - 8 bytes
- dist_epoch (u64) - 8 bytes
- pending_count (u64) - 8 bytes
- pending_this_epoch (u64) - 8 bytes
- cbob_mint (Pubkey) - 32 bytes
- max_boost_weight (u8) - 1 byte
- max_boost_epochs (u16) - 2 bytes
- boost_price (u64) - 8 bytes
- boost_weight (u8) - 1 byte
- boost_epochs (u16) - 2 bytes
- boosts_active (u32) - 4 bytes
- boosts_due (u32) - 4 bytes
- boost_weight_total (u64) - 8 bytes
- cbob_burned_total (u64) - 8 bytes
- boost_expiring ([u32; 64]) - 256 bytes

Hmm let me count the offsets from 454:
- 454-461: bare_burns_retired (u64) - 8 bytes
- 462-469: total_active_weight (u64) - 8 bytes
- 470-477: active_count (u64) - 8 bytes
- 478-493: acc_scaled (u128) - 16 bytes
- 494-509: owed_scaled (u128) - 16 bytes
- 510-517: last_distribute_at (i64) - 8 bytes
- 518-525: sales_stopped_at (i64) - 8 bytes
- 526-533: sweep_stopped_at (i64) - 8 bytes
- 534-565: pending_swap_operator (Pubkey) - 32 bytes
- 566-573: pending_swap_operator_at (i64) - 8 bytes
- 574-581: monthly_secs (i64) - 8 bytes

Hmm 574 for monthly_secs. But the comment says OFF_MONTHLY = 574. ✓

- 582-613: pending_guardian (Pubkey) - 32 bytes
- 614: pending_guardian_set (bool) - 1 byte
- 615-622: pending_guardian_at (i64) - 8 bytes
- 623-630: notice_secs (i64) - 8 bytes
- 631-638: sweep_floor_lamports (u64) - 8 bytes
- 639-646: cooldown_ceiling_secs (i64) - 8 bytes
- 647-654: reserve_ceiling_lamports (u64) - 8 bytes
- 655-662: dist_epoch (u64) - 8 bytes
- 663-670: pending_count (u64) - 8 bytes
- 671-678: pending_this_epoch (u64) - 8 bytes
- 679-710: cbob_mint (Pubkey) - 32 bytes
- 711: max_boost_weight (u8) - 1 byte
- 712-713: max_boost_epochs (u16) - 2 bytes
- 714-721: boost_price (u64) - 8 bytes
- 722: boost_weight (u8) - 1 byte
- 723-724: boost_epochs (u16) - 2 bytes
- 725-728: boosts_active (u32) - 4 bytes
- 729-732: boosts_due (u32) - 4 bytes
- 733-740: boost_weight_total (u64) - 8 bytes
- 741-748: cbob_burned_total (u64) - 8 bytes
- 749-1004: boost_expiring ([u32; 64]) - 256 bytes
- 1005-1260: padding

So boost_expiring is at 749, ending at 1004. GOV doesn't read boost_expiring.

OFF_MINT_MAX_BOOST_WEIGHT = 711. ✓
OFF_MINT_MAX_BOOST_EPOCHS = 712. ✓

So GOV reads `m.max_boost_weight` and `m.max_boost_epochs` from offsets 711 and 712 respectively. These are u8 and u16 (2 bytes). GOV reads `d[OFF_MINT_MAX_BOOST_WEIGHT]` as u8 and `u16::from_le_bytes(d[OFF_MINT_MAX_BOOST_EPOCHS..OFF_MINT_MAX_BOOST_EPOCHS + 2]`) as u16.

Let me double-check GOV code:
```rust
max_boost_weight: d[OFF_MINT_MAX_BOOST_WEIGHT],
max_boost_epochs: u16::from_le_bytes(d[OFF_MINT_MAX_BOOST_EPOCHS..OFF_MINT_MAX_BOOST_EPOCHS + 2].try_into().unwrap()),
```

OK so d[711] is u8, d[712..714] is u16 LE. Correct.

Hmm wait, but the MintConfig definition has `pub max_boost_weight: u8,` then `pub max_boost_epochs: u16,`. So at offset 711 is u8, then 2 bytes for u16 at 712-713. Correct.

Now let me verify OFF_RESERVE_CEILING = 647. We said reserve_ceiling_lamports is at offset 647-654. ✓

OFF_COOLDOWN_CEILING = 639. cooldown_ceiling_secs at 639-646. ✓

OFF_SWEEP_FLOOR = 631. sweep_floor_lamports at 631-638. ✓

OFF_PENDING_GUARDIAN_AT = 615. pending_guardian_at at 615-622. ✓

OFF_PENDING_GUARDIAN_SET = 614. pending_guardian_set at 614. ✓

OFF_PENDING_GUARDIAN = 582. pending_guardian at 582-613. ✓

OFF_NOTICE = 623. notice_secs at 623-630. ✓

OFF_MONTHLY = 574. monthly_secs at 574-581. ✓

OFF_PENDING_OP_AT = 566. pending_swap_operator_at at 566-573. ✓

OFF_PENDING_OP = 534. pending_swap_operator at 534-565. ✓

OFF_SALES_STOPPED_AT = 518. ✓

OK all the offsets check out.

Now let me look at the BURN config offsets:
- BURN_CONFIG_VERSION = 4
- OFF_MINT_VERSION = 8
- OFF_MINT_MINTED_TOTAL = 141 ✓
- OFF_MINT_BARE_RETIRED = 454 ✓

BURN reads these from MINT. Good.

Now SEAL config offsets:
- CONFIG_VERSION = 2 (in SEAL)
- OFF_VERSION = 8
- OFF_COLLECTION = 9
- OFF_RESERVES = 41

BURN reads SEAL's config. Good.

Now let me think about whether there are any issues with the boost ring wrap-around.

Looking at the boost ring: ring[BOOST_RING] = ring[64]. A boost bought at epoch E with end = E + N stores at slot (E+N) % 64.

If two boosts are bought at the same end epoch, they accumulate in the same slot. So slot can have values up to u32::MAX (but practically much smaller).

Now the issue: what if a boost end epoch is 0? Hmm, dist_epoch starts at 0 and is incremented BEFORE a distribution runs. Actually wait, dist_epoch is incremented AT THE END of credit (in advance_epoch). So initially dist_epoch = 0.

When tick runs (w=0 case), advance_epoch is called. So dist_epoch goes to 1.

But a boost can only be bought on an active vault. So no boost before the first real distribution.

For the first distribution, dist_epoch = 0 (initial). Boost bought at dist_epoch = 0 has end = 0 + N = N. Stored at slot N % 64.

After distribution, dist_epoch becomes 1 (advance_epoch from 0 to 1). Slot 1 % 64 checked. Not the boost slot.

So this works.

Hmm wait, what if a boost is bought at dist_epoch = 0, N = 64? End = 64. Slot 0 incremented.

After distribute, dist_epoch = 1. Slot 1 checked.

After 63 more distributes (so 64 total), dist_epoch = 64. Slot 0 checked. Boost slot 0 has 1. Boost moved to due.

So the boost became due at dist_epoch = 64. Total elapsed = 64 distributions.

But the boost was supposed to last N = 64 distributions. Dist at dist_epoch 0 + 1 = 1, 2, ..., 64. That's 64 distributions (1, 2, ..., 64).

Wait, the first distribute is at dist_epoch = 1 (after the first advance). Actually let me think.

dist_epoch starts at 0. No distribute happens at dist_epoch = 0. The first distribute is at dist_epoch = 0 (where credit runs at the current epoch 0). advance_epoch then goes to 1.

Hmm so dist_epoch 0 IS a valid epoch for distribute.

Wait actually let me look at distribute more carefully:
```rust
pub fn distribute<'info>(...) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    ...
    if w == 0 {
        ...
        return tick(c, now);
    }
    let owed = ceil_sats(ctx.accounts.config.owed_scaled);
    let avail = balance.checked_sub(owed).ok_or(MintError::PoolShort)?;
    require!(avail > 0, MintError::NothingToDistribute);

    if burn {
        ...
    } else {
        ...
    }

    let c = &mut ctx.accounts.config;
    credit(c, avail, w, now)?;
    msg!("CBOB_DISTRIBUTED amount={} path={}", avail, if burn { "burn" } else { "monthly" });
    ...
}
```

So credit is called at the current dist_epoch (let's call it D). After credit, dist_epoch is now D+1.

So a distribution at "epoch D" advances to D+1.

If boost was bought at dist_epoch = D, end = D+N.

For advance_epoch from D to D+1: slot (D+1) % 64 checked. Not boost slot (unless N=1).

After N distributions at D, D+1, ..., D+N-1: dist_epoch at end is D+N. Wait no.

Each distribute at dist_epoch = K does credit which does advance_epoch to K+1.

So if we have N distributes starting at K:
- Dist at K, advance to K+1.
- Dist at K+1, advance to K+2.
- ...
- Dist at K+N-1, advance to K+N.

After all N distributes, dist_epoch = K+N.

The last advance_epoch (from K+N-1 to K+N) checks slot (K+N) % 64.

So the slot checked is (K+N) % 64.

If boost was bought at K (epoch K), end = K+N, stored at slot (K+N) % 64. Same slot! So at the last advance_epoch, the boost becomes due.

But the boost was applied for the N distributes at K, K+1, ..., K+N-1. So the boost was applied for N distributes, then became due.

Wait but the first distribute is at K. Did the boost apply there?

If boost was bought BEFORE the first distribute at K: yes, credit at K uses boosted weight.

If boost was bought in the middle (e.g., between distribute K+1 and K+2): the boost applies at K+2 onwards.

OK so the boost applies for N distributes (the ones that happen between purchase and end_epoch).

Hmm actually wait, the boost purchase happens at some dist_epoch. Let me think.

A boost is purchased via boost_vault. At this moment, dist_epoch is some value, say K. The boost's end_epoch = K+N, stored at slot (K+N) % 64.

Distribute at dist_epoch = K+1: advance_epoch to K+2. Slot (K+2) % 64 checked.

...

Distribute at dist_epoch = K+N: advance_epoch to K+N+1. Slot (K+N+1) % 64 checked.

Wait, the LAST intermediate distribute before the boost becomes due is at dist_epoch = K+N. After it, dist_epoch becomes K+N+1.

But wait, the boost is supposed to apply for N distributes. The first one is at K+1 (the next after K). The last one is at K+N.

Let me count: distributes at K+1, K+2, ..., K+N. That's N distributes.

Hmm wait that's wrong. The first one after K is K+1. The last one... K+1, K+2, ..., K+N. That's N distributes (K+1 through K+N).

But the boost was supposed to last N distributes. So N distributes.

Then at advance_epoch from K+N to K+N+1, slot (K+N+1) % 64 is checked. Not the boost slot (K+N) % 64.

Hmm so the boost becomes due at the distribute AFTER K+N, not at K+N+1.

So actually the boost applies for:
- K+1, K+2, ..., K+N-1, K+N. That's N distributes.

Hmm wait, let me re-count. Distribute at K+1: 1st. At K+2: 2nd. ... At K+N: Nth.

So N distributes. OK.

Then the next distribute (at K+N+1) is REFUSED by BoostsExpireFirst because the slot (K+N) % 64 has the boost count, which was moved to due by advance_epoch from K+N to K+N+1. Wait did advance_epoch from K+N to K+N+1 move it?

advance_epoch from K+N to K+N+1: slot (K+N+1) % 64 checked. Not (K+N) % 64.

Hmm so the slot (K+N) % 64 is NOT moved to due by any advance_epoch.

The slot (K+N) % 64 is only decremented (moved to due) when the NEXT advance_epoch from K+N+1 happens, which checks slot (K+N+1) % 64. Wait that's not it either.

OK let me re-verify with a concrete example.

Boost bought at dist_epoch = 0 with N = 2. End = 2. Slot 2 incremented.

Distribute at dist_epoch = 1:
- credit. advance_epoch to 2. Slot (2) % 64 = 2 checked. Boost slot 2 has 1. Move to boosts_due.

So boost becomes due at dist_epoch = 2 (after the distribute at dist_epoch = 1 advances to 2).

But wait, the boost was supposed to last N = 2 distributes. The first distribute is at dist_epoch = 1 (next after purchase). The second is at... what?

Hmm let me re-think. The boost is bought at dist_epoch = 0. Then distributes happen at dist_epoch = 1, 2, 3, ...

The boost should apply at:
- Distribute at dist_epoch = 1 (first after purchase)
- Distribute at dist_epoch = 2 (second after purchase)

Total: 2 distributes. So N = 2.

Now when does it become due? Looking at my trace: at distribute at dist_epoch = 1, advance_epoch to 2, slot 2 checked. Boost becomes due at dist_epoch = 2.

So distribute at dist_epoch = 2 is REFUSED (because boost is now due). Wait that's the second distribute. The boost was supposed to apply there. But it was moved to due by the first distribute.

Hmm let me re-trace.

Dist at dist_epoch = 1:
- BoostsExpireFirst check. boosts_due == 0 (boost not due). pass.
- credit (with boost applied). advance_epoch to 2. Slot 2 decremented (because boost slot 2 had 1).

Now dist_epoch = 2, boosts_due = 1.

Dist at dist_epoch = 2:
- BoostsExpireFirst check. boosts_due == 1. REFUSED.

So distribute at dist_epoch = 2 is REFUSED, but the boost was supposed to apply there!

Hmm so the boost is NOT applied at dist_epoch = 2. It's only applied at dist_epoch = 1. So the boost is applied for only 1 distribute, not 2.

Wait that doesn't seem right.

Hmm let me re-check advance_epoch:
```rust
fn advance_epoch(c: &mut MintConfig) -> Result<()> {
    c.dist_epoch = c.dist_epoch.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_this_epoch = 0;
    let i = (c.dist_epoch % BOOST_RING as u64) as usize;
    c.boosts_due = c.boosts_due.checked_add(c.boost_expiring[i]).ok_or(MintError::Overflow)?;
    c.boost_expiring[i] = 0;
    Ok(())
}
```

After advance_epoch, dist_epoch is new. Slot (new % 64) checked.

If dist_epoch was 1 and is now 2, slot 2 checked. So boost at slot 2 (end = 2) is moved to due.

So at dist_epoch = 2 (after the first distribute), boosts_due = 1. The boost slot 2 is cleared.

Hmm but the boost was supposed to apply at distribute 2. So when distribute 2 is called, it should use the boost weight.

But distribute at dist_epoch = 2 is REFUSED because boosts_due = 1.

So the boost only applied at distribute 1, not distribute 2.

Hmm so my understanding is wrong somewhere. Let me look at the test case more carefully.

Test BO.21:
- Boost with epochs = BE (default 2 in the suite).
- Bought in the same tx as the distribute (in-tx).
- Boost applied at distribute (in-tx at e0).
- Advance epoch to e0+1.
- Test calls exactDist(3n) once. That's 1 distribute.
- Test checks boosts_due == 1.

So after 1 distribute past the in-tx, boost is due.

For BE = 2: the boost should apply at distributes at e0 and e0+1. After 2 distributes, boost is due.

But the test says after 1 distribute (e0+1), boost is due. So the boost applied for 1 distribute, not 2.

Wait but the in-tx distribute was at e0. After in-tx, dist_epoch = e0+1.

The exactDist is at dist_epoch = e0+1 (top of epoch). After exactDist, dist_epoch = e0+2.

So:
- In-tx distribute at dist_epoch = e0.
- ExactDist at dist_epoch = e0+1.

That's 2 distributes total. And the test says boosts_due == 1 after 2 distributes.

For BE = 2 (and 2 distributes have happened), the boost becomes due. That's N distributes.

So the math works for BE = 2: 2 distributes happened, boost is due. The boost applies at both distributes.

Let me re-verify my earlier trace. Boost bought at e0. End = e0+2. Slot (e0+2) % 64 incremented.

In-tx distribute at e0:
- credit (boost applied). advance_epoch to e0+1. Slot (e0+1) % 64 checked. Not boost slot.

ExactDist at e0+1:
- credit (boost applied). advance_epoch to e0+2. Slot (e0+2) % 64 checked. THIS IS THE BOOST SLOT. Boost moved to due.

So at dist_epoch = e0+2, boosts_due = 1.

After exactDist, the test checks (await bc()).due == 1. ✓

So the boost was applied at e0 (in-tx) and e0+1 (exactDist). That's 2 distributes (= N = BE = 2).

So my concern about off-by-one was wrong. Let me re-verify with BE = 1 (1 epoch boost):

Boost bought at dist_epoch = 0 with N = 1. End = 1. Slot 1 incremented.

In-tx distribute at 0: advance to 1. Slot 1 checked. Boost slot 1 has 1. Moved to due.

So after the in-tx, dist_epoch = 1, boosts_due = 1. Next distribute refused.

So boost was applied at 1 distribute (the in-tx). For BE = 1, that's correct.

OK so the timing is: a boost bought at dist_epoch K with N applies for N distributes at K, K+1, ..., K+N-1. Then becomes due.

Wait that's N distributes from K to K+N-1 inclusive.

For BE = 1: 1 distribute (K). ✓
For BE = 2: 2 distributes (K, K+1). ✓

But after advance_epoch from K+N-1 to K+N, the slot (K+N) % 64 is checked. So the boost becomes due at dist_epoch = K+N.

So if N distributes have happened (the boost was applied), the next advance_epoch (from K+N-1 to K+N) moves the boost to due.

The boost is applied at the first N distributes. After the Nth distribute (which is the Nth one), the advance_epoch moves it to due.

So the next distribute after the Nth one is REFUSED.

Hmm so the boost is applied for exactly N distributes. Then the (N+1)th distribute is refused unless the boost is expired first.

Wait but the test BO.21 says "ONE more makes it due: it earned exactly N (the one it rode in on counts), not N+1". 

For BE = 2:
- In-tx at e0 (1st distribute, boost applied).
- exactDist at e0+1 (2nd distribute, boost applied).
- After exactDist: dist_epoch = e0+2. boosts_due = 1.

So 2 distributes have applied the boost. The next (3rd) distribute would be refused.

The test says "earned exactly N (the one it rode in on counts), not N+1". So for N = 2, the boost earned at 2 distributes (the in-tx + the exactDist), not 3.

Hmm wait, the test wording suggests "the one it rode in on counts" - which means the in-tx distribute counts. And the next ones count too, until N.

OK so the boost is applied for N distributes. After that, it's due.

But in my trace above, the boost slot was (e0+2) % 64 for B=N=2. The advance_epoch from e0+1 to e0+2 moved it. So after that, it's due.

Wait but that's after 2 distributes. So the boost earned 2 distributes. ✓

OK so my analysis is correct. The boost is applied for N distributes, then becomes due.

Now let me think about a subtle issue: when does the boost stop being used in distribute?

Looking at distribute's credit:
```rust
fn credit(c: &mut MintConfig, avail: u64, w: u64, now: i64) -> Result<()> {
    let delta = (avail as u128).checked_mul(ACC_SCALE).ok_or(MintError::Overflow)? / (w as u128);
    c.acc_scaled = c.acc_scaled.checked_add(delta).ok_or(MintError::Overflow)?;
    c.owed_scaled = c.owed_scaled.checked_add(delta.checked_mul(w as u128).ok_or(MintError::Overflow)?)
        .ok_or(MintError::Overflow)?;
    c.last_distribute_at = now;
    advance_epoch(c)
}
```

It uses `w = total_active_weight`, which includes boost weights for active vaults (r.boost_weight).

When distribute is called:
- If boosts_due > 0: REFUSED.
- If waiting_to_join > 0: REFUSED.
- Else: proceed with credit.

If a boost is in its Nth (last) distribute, the boost weight is still in total_active_weight. The credit uses it. After credit, advance_epoch moves the boost to due.

So the next distribute is REFUSED.

Hmm OK but wait, the Nth distribute happened. The boost was applied. Then advance_epoch moves it to due. So at the start of the (N+1)th distribute, BoostsExpireFirst fires.

Yes that's the design.

But what if a claim happens between the Nth and (N++1)th distributes? The claim would expire the boost (since dist_epoch >= end_epoch after the Nth distribute).

Let me re-verify claim:
```rust
let mut touched = false;
if r.boost_weight > 0 && ctx.accounts.config.dist_epoch >= r.boost_end_epoch {
    expire_boost(&mut ctx.accounts.config, &mut r)?;
    touched = true;
}
```

So claim expires the boost if dist_epoch >= boost_end_epoch.

After the Nth distribute, dist_epoch = K+N. boost_end_epoch = K+N. So dist_epoch >= boost_end_epoch. Yes, expire_boost.

unschedule_boost:
```rust
if c.dist_epoch >= r.boost_end_epoch {
    c.boosts_due = c.boosts_due.checked_sub(1).ok_or(MintError::Overflow)?;
}
```

Decrements boosts_due.

So if claim happens after the Nth distribute (when boost is already in due), it decrements boosts_due (1 -> 0). Then a future distribute can proceed.

OK so the flow is:
- Nth distribute happens. Boost applied. After advance_epoch, boosts_due = 1.
- Claim happens. expire_boost runs. boosts_due = 0.
- (N+1)th distribute happens. BoostsExpireFirst passes (boosts_due = 0). Boost no longer applied (boost_weight = 0).

So the boost is applied for exactly N distributes. 

Now let me look at potential issues with the level draw and entropy.

```rust
fn try_capture(sh: &AccountInfo, reveal_slot: u64, now: u64, asset: &Pubkey) -> Result<Capture> {
    if now <= reveal_slot { return Ok(Capture::NotYet); }
    if now > reveal_slot.checked_add(REVEAL_WINDOW_SLOTS).ok_or(MintError::Overflow)? {
        return Ok(Capture::Expired);
    }
    let mut want = reveal_slot;
    let mut hs: [[u8; 32]; 3] = [[0u8; 32]; 3];
    for h in hs.iter_mut() {
        match blockhash_in_window(sh, want)? {
            Some((hash, slot)) => {
                *h = hash;
                want = (slot / LEADER_GROUP_SLOTS).checked_add(ENTROPY_GROUP_STRIDE).ok_or(MintError::Overflow)?
                    .checked_mul(LEADER_GROUP_SLOTS).ok_or(MintError::Overflow)?;
            }
            None => return Ok(Capture::NotYet),
        }
    }
    Ok(Capture::Got(hashv(&[&hs[0], &hs[1], &hs[2], asset.as_ref()]).to_bytes()))
}
```

So try_capture:
1. If now <= reveal_slot: NotYet.
2. If now > reveal_slot + REVEAL_WINDOW_SLOTS: Expired.
3. Loop 3 times to capture A, B, C hashes.
4. Each iteration: find the smallest produced slot in [want, want + 64]. Update want to (slot / 4) * 4 + 8 for next iteration.
5. If any iteration doesn't find one: NotYet.

So A, B, C are captured from windows starting at reveal_slot, then (slot/4)*4 + 8, then ((slot/4)*4 + 8)/4 * 4 + 8.

Hmm let me look at this more carefully. After capturing A at slot S, want becomes (S/4 + 2) * 4 = S/4 * 4 + 8 (integer math: (S/4 + 2) * 4 = S/4*4 + 8).

Actually wait, (S/4 + 2) * 4. In Rust, S/4 is integer division. So if S = 100: (100/4 + 2) * 4 = (25 + 2) * 4 = 27 * 4 = 108.

If S = 103: (103/4 + 2) * 4 = (25 + 2) * 4 = 27 * 4 = 108. But 103/4 = 25 (floor).

Hmm wait, 103/4 = 25 with remainder 3. So (S + 8) / 4 * 4 (next 4-aligned after S).

Wait actually (S/4 + 2) * 4. If S/4 = K, then want = (K + 2) * 4 = 4K + 8.

If S = 100: K = 25, want = 108. 108 > 100.
If S = 101: K = 25, want = 108. 108 > 101.
If S = 103: K = 25, want = 108. 108 > 103.
If S = 104: K = 26, want = 112. 112 > 104.

OK so want is (S/4 + 2) * 4. This skips ahead by 8 slots from S's group.

The intent: A, B, C should be in DIFFERENT leader groups. Each leader group is 4 slots. So A in group A_grp, B in group B_grp where B_grp >= A_grp + 2, C in group C_grp where C_grp >= B_grp + 2.

If A is in group A_grp (slots [A_grp*4, A_grp*4+3]), and A was at slot S, then S / 4 = A_grp (approximately, depending on whether S is exactly at the group start).

Hmm actually the leader group is slots [N*4, N*4+3] for N = 0, 1, 2, ...

If A's slot is S, then S is in some group G = floor(S / 4).

For B to be in group G+2 (or later), want >= (G+2)*4 = G*4 + 8.

So want = (S / 4 + 2) * 4. ✓

OK the math is correct.

Now what about the entropy mix?

```rust
Ok(Capture::Got(hashv(&[&hs[0], &hs[1], &hs[2], asset.as_ref()]).to_bytes()))
```

So entropy = sha256(hA || hB || hC || asset).

Asset is mixed in last. So the draw is specific to the asset (vault). Two different assets in the same slot can produce DIFFERENT levels because of the asset address in the hash.

Good, no two assets share the same draw.

Now let me look at the level selection:
```rust
let remaining: Vec<u64> = (0..5).map(|i| (c.level_caps[i] as u64).saturating_sub(c.level_minted[i] as u64)).collect();
let total: u64 = remaining.iter().sum();
require!(total > 0, MintError::LevelCapReached);
let li = {
    let mut x = u64::from_le_bytes(entropy[0..8].try_into().unwrap()) % total;
    let mut pick = 0usize;
    for (i, r) in remaining.iter().enumerate() {
        if x < *r { pick = i; break; }
        x -= *r;
    }
    pick
};
c.level_minted[li] = c.level_minted[li].checked_add(1).ok_or(MintError::Overflow)?;
c.revealed_total = c.revealed_total.checked_add(1).ok_or(MintError::Overflow)?;
let r = &mut ctx.accounts.vault_record;
r.level = (li + 1) as u8;
```

So:
1. Compute remaining = level_caps - level_minted for each level.
2. total = sum of remaining.
4. Pick x = entropy[0..8] LE % total.
5. Walk through remaining; the first level where x < remaining is the pick.
6. Increment level_minted[li], revealed_total.
7. Set r.level = li + 1.

This is a fair sequential draw (without replacement). The odds of each level are remaining[i] / total, which decreases as more of that level is drawn.

For 0..=N level draws: level I takes its given cap first, then level II, etc.

Hmm wait, this is "without replacement" but not stratified. Each draw picks from the remaining caps. So if 100 vaults have been drawn (out of 945 for level I), the remaining is (845, 525, 315, 210, 105) = 2000. The probability of level I is 845/2000.

This is fair in terms of exact quota fulfillment.

Now let me check the `reschedule_reveal`:

```rust
pub fn reschedule_reveal(ctx: Context<RescheduleReveal>) -> Result<()> {
    let now = Clock::get()?.slot;
    let r = &mut ctx.accounts.vault_record;
    require!(r.level == 0 && !r.entropy_set, MintError::AlreadyCaptured);
    require!(now > r.reveal_slot.checked_add(REVEAL_WINDOW_SLOTS).ok_or(MintError::Overflow)?,
        MintError::RescheduleTooEarly);
    reschedule(r, now)
}
```

Hmm wait, this checks `r.level == 0 && !r.entropy_set`. So only unleveled AND un-captured vaults can be rescheduled.

But what about a vault that has entropy captured but level not yet drawn? E.g., captured but waiting in queue.

If r.entropy_set is true, AlreadyCaptured is returned. Can't reschedule.

If r.level == 0 but r.entropy_set is true, AlreadyCaptured.

Hmm so once entropy is captured, you can't reschedule. That's because the entropy is stored on the record.

OK that's correct.

But what about the `reveal_level` flow?

```rust
let entropy: [u8; 32] = if set { stored } else {
    match try_capture(&ctx.accounts.slot_hashes.to_account_info(), reveal_slot, now, &asset)? {
        Capture::Got(e) => {
            let r = &mut ctx.accounts.vault_record;
            r.entropy = e; r.entropy_set = true;
            e
        }
        Capture::NotYet => return err!(MintError::RevealTooEarly),
        Capture::Expired => return err!(MintError::NeedsReschedule),
    }
};
```

So reveal_level either uses stored entropy or captures new. If Expired (window passed), returns NeedsReschedule.

So the flow is: caller first calls capture_entropy to save entropy for vaults in their window. Then later calls reveal_level. If window passed without capture, caller calls reschedule_reveal, then reveal_level.

Hmm but if reschedule_reveal sets new reveal_slot, the entropy storage from capture_entropy at the OLD reveal_slot is still stored. Does reschedule_reveal clear it?

Looking at reschedule:
```rust
fn reschedule(r: &mut VaultRecord, now: u64) -> Result<()> {
    let old = r.reveal_slot;
    r.reveal_slot = now.checked_add(REVEAL_LEAD_SLOTS).ok_or(MintError::Overflow)?;
    r.reschedules = r.reschedules.saturating_add(1);
    msg!("CBOB_REVEAL_RESCHEDULED asset={} mint_index={} old_slot={} new_slot={} times={}",
        r.asset, r.mint_index, old, r.reveal_slot, r.reschedules);
    emit!(RevealRescheduled { asset: r.asset, mint_index: r.mint_index, old_reveal_slot: old,
        new_reveal_slot: r.reveal_slot, reschedules: r.reschedules });
    Ok(())
}
```

So reschedule just updates reveal_slot. The entropy_set flag is unchanged. Hmm.

If entropy was captured at old reveal_slot, then r.entropy_set is true. Then reschedule_reveal is called. r.reveal_slot becomes now + 16. r.entropy_set still true.

Then reveal_level:
```rust
let set = r.entropy_set;
let stored = r.entropy;
...
let entropy: [u8; 32] = if set { stored } else { ... };
```

Uses stored entropy. The draw happens. But the entropy is based on the OLD slot hashes (from the old reveal_slot).

Hmm is that intended? Let me think.

Actually, the design says entropy is captured before the window expires. If captured, the draw can happen later. The entropy doesn't need to be re-captured because it was captured at the right time.

But the reschedule is supposed to be for FAILED captures (window passed without capture). If entropy was captured, no need to reschedule.

So reschedule_reveal should only be called when entropy was NOT captured. The check `r.level == 0 && !r.entropy_set` ensures this.

Hmm but wait, the check is BEFORE reschedule. What if entropy was captured at old reveal_slot but level not drawn yet (waiting in queue)?

Looking at the FIFO: reveal_level advances revealed_total only when level is drawn. If entropy is captured but level not drawn, the vault is waiting in the queue.

For the level to be drawn, reveal_level must be called. If reveal_slot has passed but entropy was captured (r.entropy_set = true), reveal_level uses stored entropy and draws. 

The vault never needs reschedule if entropy was captured.

OK so reschedule is only for cases where entropy was never captured. The check ensures this.

Hmm wait, but then why does the test L.17 test reschedule? Let me look:

```typescript
{ const eIdx=Number((await recOf(E.asset))!.readBigUInt64LE(OFF_REC_INDEX))
  await revealAllUpTo(eIdx)
  const rvE0=await att(()=>send([ixReveal(E.asset,E.attrs)],[deployer]))
  rec('L.16','reveal a vault whose window passed with NO entropy (stage 2 gave it the lowest level)','REJECT',rvE0.ok?'ALLOW':'REJECT',rvE0.err)
  const vnFirst=await att(()=>send([ixReveal(VN.asset,VN.attrs)],[deployer]))
  rec('L.16a','...and the vault BEHIND it, entropy in hand, still waits (nobody behind is drawn first)','REJECT',vnFirst.ok?'ALLOW':'REJECT',vnFirst.err)
  const Fr=await mkVault(0n)
  await waitEntropy(Fr.asset)
  const early=await att(()=>send([ixReschedule(Fr.asset)],[deployer]))
  rec('L.16b','reschedule a vault whose window is still OPEN (capture it instead)','REJECT',early.ok?'ALLOW':'REJECT',early.err)
  await send([ixCapture(Fr.asset)],[deployer])
  const sig=await send([ixReschedule(E.asset)],[deployer])
  ...
  rec('L.17','the missed window is RESCHEDULED to a slot that did not exist when it landed',String(slot+REVEAL_LEAD),String(newRs),...)
  ...
}
```

So the test reschedules E (which had window pass without capture) and not Fr (which had entropy captured).

OK so my understanding is correct.

But wait, there's an interesting edge case: what if entropy was captured at the OLD reveal_slot, and then reschedule is called? It would be refused because entropy_set is true.

But what about the FIFO? The vault is in the queue (entropy_set=true, level=0). When the queue reaches it (revealed_total = mint_index), reveal_level is called. Stored entropy is used. Level is drawn. revealed_total advances.

OK so this works.

Now let me look at a subtle issue. What if the reschedule is called when the window has NOT passed?

```rust
require!(now > r.reveal_slot.checked_add(REVEAL_WINDOW_SLOTS).ok_or(MintError::Overflow)?,
    MintError::RescheduleTooEarly);
```

So requires now > reveal_slot + REVEAL_WINDOW_SLOTS (i.e., now > window_end). Refused if window is still open.

What if entropy was captured and window passed? Captured means r.entropy_set = true. Reschedule check `!r.entropy_set` refuses.

Hmm but what about a corner case: entropy was captured in window, then window passes, then someone calls reschedule. AlreadyCaptured fires.

But what if no one is bothered to call reveal_level to draw the level? The vault sits in queue with entropy captured. The FIFO waits.

OK no issue.

Now let me look at another potential issue: the boost's end_epoch vs the boost's expiry in the field.

Looking at boost_end_epoch: it's set in boost_vault:
```rust
let end = c.dist_epoch.checked_add(epochs as u64).ok_or(MintError::Overflow)?;
...
r.boost_end_epoch = end;
```

So boost_end_epoch = dist_epoch at time of purchase + epochs.

When the boost is checked for expiry:
```rust
fn expire_boost(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    require!(r.boost_weight > 0 && c.dist_epoch >= r.boost_end_epoch, MintError::BoostNotDue);
    ...
}
```

So require dist_epoch >= boost_end_epoch.

When the boost was bought at dist_epoch = K with N, end = K+N. At dist_epoch = K+N, the check passes (>=).

At dist_epoch = K+N-1, the check fails (<). So boost is still active.

OK so the boost is expired starting at dist_epoch = K+N.

After advance_epoch from K+N-1 to K+N (during the Nth distribute), the boost becomes due. So the next distribute (at K+N) is refused by BoostsExpireFirst.

Wait but actually I need to look at this more carefully. Let me re-trace:

Boost bought at dist_epoch = K with N = 2. End = K+2.

Distribute at dist_epoch = K+1:
- BoostsExpireFirst: boosts_due = 0. Pass.
- credit uses boost. advance_epoch to K+2. Slot (K+2) % 64 checked. Boost slot decremented, moved to boosts_due.

So after this distribute, dist_epoch = K+2, boosts_due = 1.

Distribute at dist_epoch = K+2:
- BoostsExpireFirst: boosts_due = 1. REFUSED.

Hmm so distribute at K+2 is REFUSED, but the boost was supposed to apply there!

Wait, that contradicts what I said before. Let me re-trace more carefully.

Actually I realize my mistake. Let me re-trace the exact sequence.

At the START of distribute at dist_epoch = K+1:
- BoostsExpireFirst: check boosts_due = 0. Pass.
- Read total_active_weight (includes boost_weight).
- credit with w = total_active_weight. delta computed.
- Credit calls advance_epoch: dist_epoch = K+2. Slot (K+2) % 64 checked. Boost slot decremented. boosts_due = 1.

So the credit at dist_epoch = K+1 USED the boost. Then the boost was moved to due.

So the boost was active for the distribute at K+1 (1 distribute). Not for the one at K+2.

But the boost was supposed to last N = 2 distributes. So it should apply at K+1 AND K+2 (2 distributes).

Hmm but the code moves the boost to due after the 1st distribute, so the 2nd is refused.

So the bug: a boost bought at dist_epoch = K with N epochs only applies for N-1 distributes, not N.

Wait let me re-verify with the test BO.21.

Test:
- Boost bought at e0 (in same tx as distribute). End = e0+2.
- In-tx distribute at e0:
  - BoostsExpireFirst: pass.
  - Credit uses boost weight. Advance_epoch to e0+1. Slot (e0+1) % 64 checked. NOT the boost slot.
- Then 1 exactDist:
  - Distribute at e0+1: BoostsExpireFirst: pass. Credit uses boost. Advance_epoch to e0+2. Slot (e0+2) % 64 checked. THIS is the boost slot. Move to due.

So after the test's 1 exactDist, dist_epoch = e0+2, boosts_due = 1.

The test then checks `(await bc()).due == 1` (true).

So the boost is in due after 1 exactDist (which is the 2nd distribute). The 2nd distribute used the boost.

The 1st distribute (in-tx) used the boost.

So the boost was used for 2 distributes, which is BE = 2. ✓

But wait, this contradicts my earlier trace. Let me re-trace.

Distribute at e0 (in-tx, [boost, distribute] order):
- boost instruction runs first. dist_epoch = e0. end = e0+2. Boost slot 2 incremented. Record updated.
- distribute instruction runs. BoostsExpireFirst: pass (boosts_due = 0). credit uses boost weight. advance_epoch: dist_epoch = e0+1. Slot (e0+1) % 64 checked. Not boost slot.

So in-tx distribute at e0: 1st. Boost applied.

ExactDist at e0+1:
- Distribute. BoostsExpireFirst: pass (boosts_due = 0). credit uses boost. advance_epoch: dist_epoch = e0+2. Slot (e0+2) % 64 checked. THIS IS THE BOOST SLOT. Move to due.

So exactDist at e0+1: 2nd. Boost applied. After: dist_epoch = e0+2, boosts_due = 1.

So the boost was used in 2 distributes (e0 and e0+1). ✓

Then if a 3rd distribute at e0+2 is attempted, BoostsExpireFirst refuses.

So for BE = 2, the boost is used for 2 distributes. The test confirms this. My earlier confusion was wrong.

OK so the boost schedule is correct: applied for N distributes, then becomes due.

Great. Let me move on.

Let me look at the `$CBOB` boost carefully. The boost is at most 12 (ruled). And at most 24 distributions. With 2100 vaults, max boost = 12, max total_active_weight = 6 + 12 = 18 per vault.

Hmm but max boost_weight_total = 12 * 2100 = 25200. Plus the regular weights: 945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 1890+2025+1575+1050+630 = 7170 + 25200 = 32370 max.

OK that's a large number. Let me check for overflow.

In `boost_vault`:
```rust
c.boost_weight_total = c.boost_weight_total.checked_add(extra as u64).ok_or(MintError::Overflow)?;
```

Checked add. Good.

In `reweigh`:
```rust
c.total_active_weight = c.total_active_weight.checked_sub(before).ok_or(MintError::Overflow)?
    .checked_add(after).ok_or(MintError::Overflow)?;
```

Checked. Good.

OK so the arithmetic is checked. No overflow.

Now let me look at the boost's potential issue with carry and debt.

Boost bought at dist_epoch K, weight = level_weight + extra.

reweigh(c, r, extra):
- before = level_weight.
- owed = owed_of(r, c.acc_scaled) = level_weight * acc + carry_old - debt_old.
- boost_weight = extra.
- after = level_weight + extra.
- r.carry_scaled = owed.
- r.debt_scaled = (after) * acc = (level_weight + extra) * acc.

So after reweigh:
- weight = level_weight + extra.
- pending = weight * acc + carry - debt = (level_weight + extra) * acc + owed - (level_weight + extra) * acc = owed.

So pending = owed (unchanged). ✓

When boost is later expired:
- expire_boost calls unschedule_boost (decrements boosts_active and ring/boosts_due).
- expire_boost calls reweigh(c, r, 0):
  - before = level_weight + extra.
  - owed = owed_of(r, c.acc_scaled) = (level_weight + extra) * acc + carry - debt = (level_weight + extra) * acc + owed - (level_weight + extra) * acc = owed.
  - boost_weight = 0.
  - after = level_weight.
  - r.carry_scaled = owed.
  - r.debt_scaled = level_weight * acc.

So after expire_boost:
- weight = level_weight.
- pending = level_weight * acc + carry - debt = level_weight * acc + owed - level_weight * acc = owed.

So pending unchanged. ✓

So the boost doesn't change the owed amount, only the rate going forward.

But the issue is the boost was applied for N distributes. So in those N distributes, the vault's owed grew by extra * delta (per distribute).

Wait, delta depends on total_active_weight (which includes boosts). So delta is different than without boost.

Hmm let me think. Without boost:
- total = w_old
- delta_old = avail * SCALE / w_old

With boost:
- total = w_old + extra
- delta_new = avail * SCALE / (w_old + extra)

delta_new < delta_old. So the per-unit increase is smaller.

For each distribute, the vault gets weight * delta_new (with boost). Without boost, the vault would get weight * delta_old.

So with boost, the vault earns LESS per distribute than without boost. The extra boost doesn't add to the vault's earnings - it just shifts distribution among vaults.

Actually wait, the boost DOES add value to the vault's share. Let me re-think.

If vault A has boost extra, and total active weight was w_before = sum_other + w_A. Then with boost, total = w_before + extra.

delta = avail * SCALE / total.

Vault A's earned = delta * (w_A + extra).

Vault B's earned (no boost) = delta * w_B.

Vault A's old earned (without boost) would have been delta_old * w_A, where delta_old = avail * SCALE / w_before.

delta * (w_A + extra) vs delta_old * w_A.

If extra > 0, then total > w_before, delta < delta_old. delta * (w_A + extra) vs delta_old * w_A.

Let's see: delta * (w_A + extra) = (avail * SCALE / total) * (w_A + extra) = avail * SCALE * (w_A + extra) / total.

delta_old * w_A = avail * SCALE * w_A / w_before.

Comparison: (w_A + extra) / total vs w_A / w_before.

total = w_before + extra. w_A + extra > w_A (assuming extra > 0).

(w_A + extra) / (w_before + extra) vs w_A / w_before.

Cross multiply: (w_A + extra) * w_before vs w_A * (w_before + extra).
LHS - RHS = w_A * w_before + extra * w_before - w_A * w_before - w_A * extra = extra * (w_before - w_A) = extra * w_other (where w_other = w_before - w_A).

Since w_other > 0 (other vaults exist), LHS > RHS. So (w_A + extra) / total > w_A / w_before.

So delta * (w_A + extra) > delta_old * w_A. The boost DOES give vault A a larger share per distribute.

Great, so the boost works as intended.

But the boost's effect is more significant when w_other is large (many other vaults). When w_other is small (few other vaults), the boost's effect is more significant.

Hmm OK.

Now let me check the boost timing again. The boost's end_epoch = K+N (K = purchase dist_epoch, N = epochs). The boost is active at distributes K, K+1, ..., K+N-1 (N distributes). After K+N-1, advance_epoch moves to K+N, and the boost is moved to due.

But wait, the test BO.21 says "ONE more makes it due". So after 1 more distribute (BE = 2 case), it's due.

The 1 more distribute is at e0+1 (after in-tx at e0). After this distribute, advance_epoch to e0+2. Slot (e0+2) % 64 = (boost end) % 64. Boost moved to due.

OK so the math is right.

Now let me think about a subtle issue: what if the boost is bought in the SAME tx as the distribute, but in the WRONG order?

Test BO.21: [boost, distribute]. Boost first, then distribute.
Test BO.35: [distribute, boost]. Distribute first, then boost.

For BO.35:
- Distribute at e0. credit uses no boost (boost not bought yet). advance_epoch to e0+1.
- Boost at e0+1. end = e0+1+BE. Stored at slot (e0+1+BE) % 64.

So boost bought at e0+1, end = e0+1+BE.

For BE = 2: end = e0+3. Slot (e0+3) % 64.

After 1 exactDist at e0+2: advance to e0+3. Slot (e0+3) % 64 checked. THIS IS THE BOOST SLOT. Boost moved to due.

So after 1 exactDist from e0+2, boost is due.

The test asserts (await bc()).due == 1 after BE = 2 distributes from e0+2.

For BE = 2: 2 distributes from e0+2. After 1st: dist_epoch = e0+3. Slot (e0+3) checked. Boost moved to due. So after 2nd (at e0+3), boosts_due = 1.

Hmm wait but distribute at e0+3 would be refused by BoostsExpireFirst.

Actually let me re-verify the test:

```typescript
const rev=await att(()=>send([ixDistribute(burnBy(alice)),ixBoost(X,alice)],[alice]))
const rx=await recB(X), c1=await bc()
rec('BO.35','[distribute, boost] in ONE transaction land: the boost is bought in the NEW epoch and ends at e+1+N',
  `ALLOW,${e0+1n+BigInt(BE)},${e0+1n}`,`${rev.ok?'ALLOW':'REJECT'},${rx.end},${c1.epoch}`,rev.err)
for(let i=0;i<BE;i++) await exactDist(3n)
rec('BO.35a','...and N MORE distributions make it due, at exactly e+1+N',`1,${e0+1n+BigInt(BE)}`,`${(await bc()).due},${(await bc()).epoch}`)
```

So after BE = 2 distributes from e0+1 (since after in-tx, dist_epoch = e0+1), dist_epoch = e0+1+2 = e0+3. Boost slot is (e0+1+BE) % 64 = (e0+3) % 64.

The last distribute in the loop (at dist_epoch = e0+2) advances to e0+3. Slot (e0+3) % 64 checked. Boost slot moved to due.

So after the loop, dist_epoch = e0+3, boosts_due = 1. The test asserts `(await bc()).due == 1`. ✓

So for BO.35, the boost applied for 2 distributes: e0+1 (no wait, e0+1 was AFTER the in-tx distribute which moved to e0+1; the first exactDist is at e0+1, the second at e0+2).

Wait, after in-tx at e0+1, the first exactDist is at top of e0+1. Distribute at e0+1, advance to e0+2. Second exactDist at e0+2, advance to e0+3.

So distributes at e0+1 and e0+2 (2 distributes). Both used boost.

Total: 2 distributes for boost that was bought at e0+1 (in-distribute order) with N = 2 (BE). Wait but the boost was bought at e0+1, end = e0+1+2 = e0+3. And it applied at e0+1 and e0+2. That's 2 distributes, which is BE = 2. ✓

So in this scenario, the boost was bought in the NEW epoch (after the in-tx distribute advanced). The in-tx distribute did NOT use the boost (boost not yet bought).

Hmm interesting. So depending on the order, the in-tx distribute may or may not use the boost.

For BO.21 ([boost, distribute]): in-tx distribute uses boost (boost bought first).
For BO.35 ([distribute, boost]): in-tx distribute does NOT use boost (boost bought after).

OK so the boost timing is consistent.

Now let me think about another potential issue: what if the boost ring wraps around?

For N = 64 boosts, end = K + 64. Slot (K+64) % 64 = K % 64. So boost at slot K.

What if there's already another boost ending at the same slot (i.e., bought at K-64 with N = 64)? Then slot K has 2.

advance_epoch brings dist_epoch from K+63 to K+64. Slot K % 64 checked. 2 moved to boosts_due.

Then 2 distribute (one per vault) would be needed to expire both boosts. Boosts_due = 2.

So 2 boosts expire in the same epoch. Both vaults get their expire_boost called.

OK so ring wraparound works.

Now let me think about another subtle issue: what if the ring wraparound happens WITHIN a single boost's life?

A boost with N = 64 ends at K+64. Stored at slot K. Slot K was at (K) % 64.

If a previous boost with end at K-64 was stored at slot K. So slot K has 2.

When dist_epoch reaches K+64 (after 64 distributes from K), the slot K % 64 is checked. The 2 boosts become due.

OK so this works.

What about a boost with N = 65? End = K+65. Slot (K+65) % 64 = (K+1) % 64.

If another boost with end at K+1 was stored at slot (K+1) % 64. Both moved to due at advance_epoch from K+1 to K+2.

Hmm but the boost's first distribute is at K+1. Second at K+2. So advance_epoch from K+2 to K+3. Slot (K+3) % 64 checked. Not (K+1) % 64.

So the slot (K+1) % 64 is NOT checked at the right time.

Hmm wait let me re-trace.

Boost bought at K with N = 65. End = K+65. Slot (K+65) % 64 = (K+1) % 64.

Distribute at K+1: credit uses boost. advance to K+2. Slot (K+2) % 64 checked.
Distribute at K+2: credit uses boost. advance to K+3. Slot (K+3) % 64 checked.
...
Distribute at K+64: credit uses boost. advance to K+65. Slot (K+65) % 64 = (K+1) % 64 checked. Boost slot decremented. Moved to due.

So after 64 distributes (from K+1 to K+64), the boost is moved to due. The (N+1)th distribute (at K+65) would be refused.

So the boost applied for 64 distributes (from K+1 to K+64). For N = 65, the boost should apply for 65 distributes.

Hmm but here it only applied for 64.

Wait, actually let me count again. N = 65. Boost should apply for distributes at K, K+1, ..., K+N-1 = K+64. That's 65 distributes.

But my trace says:
- Distribute at K+1: 1st.
- Distribute at K+2: 2nd.
- ...
- Distribute at K+64: 64th.

So 64 distributes, not 65. The first distribute at K is the one where the boost was bought. Hmm but at the moment of purchase, the distribute at K hadn't happened yet (or had, depending on order).

OK so if the boost was bought BETWEEN distributes, it applies at the NEXT distribute onwards.

For the boost bought at K (not in any distribute tx), it applies at:
- Distribute at K+1: 1st.
- Distribute at K+2: 2nd.
- ...
- Distribute at K+65: 65th.

After distribute at K+65, advance to K+66. Slot (K+66) % 64 = (K+2) % 64. NOT the boost slot (K+1) % 64.

Hmm so the boost slot is never checked by advance_epoch.

Hmm wait wait wait. Let me re-verify.

Boost bought at K with N = 65. End = K+65. Slot (K+65) % 64 = (K+1) % 64. So slot S = (K+1) % 64.

After advance_epoch bringing dist_epoch to S = K+1, slot S % 64 = (K+1) % 64 = S. The slot S is checked. Boost slot decremented. Moved to due.

So at dist_epoch = S = K+1 (after advance_epoch from K to K+1), boost is in due.

But wait, the boost was bought at dist_epoch = K. So at dist_epoch = K (just after purchase), the boost is active. The first distribute at K+1 uses boost.

Hmm so the boost applies for distributes at K+1, K+2, ..., K+65. That's 65 distributes.

But advance_epoch from K to K+1 moves the boost to due. So after the first distribute at K+1, the boost is in due.

So the boost applied for only 1 distribute, not 65. Same issue as before.

Hmm wait that's different. Let me re-trace very carefully.

OK so for a boost with end = K+N, slot (K+N) % 64 is incremented at purchase.

advance_epoch at dist_epoch = K: dist_epoch becomes K+1. Slot (K+1) % 64 checked. Not the boost slot (unless N = 1, then (K+1) % 64 = (K+1) % 64, same as (K+1) % 64. But for N = 1, end = K+1, slot = K+1).

Hmm wait, for N = 1, end = K+1, slot (K+1) % 64. After advance_epoch from K to K+1, slot (K+1) % 64 checked. So boost moved to due at K+1.

For N = 65, end = K+65, slot (K+65) % 64 = (K+1) % 64. Same slot as N=1!

Hmm so the ring slot for N = 1 and N = 65 (mod 64) is the same. The slot doesn't distinguish between them.

But the timing is different. For N = 1, end = K+1, slot K+1. For N = 65, end = K+65, slot (K+65) % 64 = K+1.

Both stored at slot K+1. Both should become due at advance_epoch bringing dist_epoch to K+1.

For N = 65, that's after 1 distribute (at K+1). So boost applied for 1 distribute.

For N = 1, that's after 1 distribute (at K+1). So boost applied for 1 distribute.

But the boosts have different N! They should apply for different numbers of distributes.

Wait, so the ring slot is supposed to be the END epoch mod 64. The end is when the boost becomes due. The boost applies for N distributes BEFORE its end.

For N = 65, the boost should apply for 65 distributes. So end - 65 = K should be the start. Distributes at K, K+1, ..., K+64 (65 distributes).

But end = K + 65. So slot (K + 65) % 64. For the FIRST time advance_epoch brings dist_epoch to (K + 65) % 64... well, the slot is checked when advance_epoch results in dist_epoch such that dist_epoch % 64 == (K + 65) % 64.

So when dist_epoch = K + 65 (after 65 distributes from K to K+1, K+2, ..., K+64... wait that's 64 distributes), the slot K+65 is reached.

Hmm let me count again.

Distribute at dist_epoch = X:
- credit.
- advance_epoch. dist_epoch becomes X+1.

So if I have N distributes starting at dist_epoch = K, the final dist_epoch after all is K + N.

In each advance_epoch from K+i-1 to K+i, slot (K+i) % 64 is checked.

For i = 1 to N: slot (K+i) % 64 is checked.

For the boost at end = K+N, slot (K+N) % 64. So at advance_epoch N (from K+N-1 to K+N), slot (K+N) % 64 is checked.

So the slot is checked ONCE at advance_epoch from K+N-1 to K+N.

In total, the boost is used in distributes at K+1, K+2, ..., K+N-1 (after each, advance_epoch is called). At the (N-1)th advance_epoch (from K+N-1 to K+N), slot (K+N) % 64 is checked.

So the boost is used in N-1 distributes (K+1 through K+N-1).

Hmm wait, the boost is bought at dist_epoch = K. The first distribute at K+1 uses boost. The (N-1)th distribute is at K+N-1. After this, advance to K+N. Slot (K+N) % 64 checked.

So the boost is used in N-1 distributes, not N.

Unless the boost is bought in the same tx as a distribute. Then the in-tx distribute uses boost. So it's N distributes.

But if the boost is bought BETWEEN distributes (not in any distribute tx), it's N-1 distributes.

So this is an off-by-one bug! The boost should apply for N distributes, but in this scenario it applies for N-1.

Wait but the test BO.21 expected the boost to apply for BE distributes (the one it rode in on counts). And the test passed. Let me re-verify.

In BO.21:
- Boost with epochs = BE = 2 (default).
- Boost bought in the same tx as distribute.
- Distribute uses boost (in-tx).
- After in-tx: dist_epoch = e0+1.
- exactDist runs once. Distribute at e0+1, advance to e0+2.

So 2 distributes total. The first (in-tx at e0) used boost. The second (at e0+1) used boost.

After the 2nd distribute, dist_epoch = e0+2. Slot (e0+2) % 64 = (e0+BE) % 64 = (e0+2) % 64. Boost moved to due.

So the boost was used in 2 distributes (in-tx at e0, exactDist at e0+1). BE = 2.

If I change the order to [distribute, boost]:
- Distribute at e0. advance to e0+1.
- Boost at e0+1. end = e0+1+BE = e0+3.
- Then exactDist at e0+2. advance to e0+3. Slot (e0+3) % 64 = (e0+3) % 64. Boost slot. Moved to due.
- exactDist at e0+3. Would be refused.

So the boost was used in 2 distributes (at e0+1 and e0+2). BE = 2. ✓

So the test passes for BE = 2.

But what about a higher N? Let me imagine BE = 5:
- [distribute, boost]. Distribute at e0. advance to e0+1.
- Boost at e0+1. end = e0+1+5 = e0+6. Slot (e0+6) % 64.
- exactDist at e0+1 (1st). advance to e0+2. Slot (e0+2) checked.
- exactDist at e0+2 (2nd). advance to e0+3. Slot (e0+3) checked.
- exactDist at e0+3 (3rd). advance to e0+4. Slot (e0+4) checked.
- exactDist at e0+4 (4th). advance to e0+5. Slot (e0+5) checked.
- exactDist at e0+5 (5th). advance to e0+6. Slot (e0+6) checked. THIS IS THE BOOST SLOT. Moved to due.

So the boost applied for 5 distributes (e0+1, e0+2, e0+3, e0+4, e0+5). After the 5th, boost is due.

So for BE = 5: 5 distributes applied the boost. ✓

Hmm OK so the boost applies for BE distributes. But what if I don't buy in-tx?

[no in-tx]. Boost bought at e0. end = e0+5. Slot (e0+5) % 64.

- exactDist at e0 (1st). advance to e0+1. Slot (e0+1) checked.
- exactDist at e0+1 (2nd). advance to e0+2. Slot (e0+2) checked.
- exactDist at e0+2 (3rd). advance to e0+3. Slot (e0+3) checked.
- exactDist at e0+3 (4th). advance to e0+4. Slot (e0+4) checked.
- exactDist at e0+4 (5th). advance to e0+5. Slot (e0+5) checked. THIS IS THE BOOST SLOT. Moved to due.

So 5 distributes applied the boost. ✓

Hmm so even without in-tx distribute, the boost applied for 5 distributes. So my concern about off-by-one is wrong.

Wait let me recount. The boost was bought at dist_epoch = e0. Then distributes happen at e0+1, e0+2, e0+3, e0+4, e0+5. That's 5 distributes.

So if the boost is bought at dist_epoch = e0, the first distribute is at e0+1. Each distribute uses boost. Total distributes = N (where N = epochs).

Hmm OK so the boost applies for N distributes starting from the first one after purchase.

So the timing is:
- Distribute at e0: NO boost (not bought yet).
- Distribute at e0+1: 1st (boost used). end epoch = e0 + N. Stored at slot (e0+N) % 64.
- ...
- Distribute at e0+N: Nth (boost used). end = e0+N. After this distribute, advance to e0+N+1. Slot (e0+N+1) % 64 checked. NOT the boost slot.

Wait, then the boost is never moved to due!

Hmm let me re-trace. The slot is (e0+N) % 64. Advance_epoch from e0+N to e0+N+1: slot (e0+N+1) % 64 checked. Not the boost slot.

Advance_epoch from e0+N-1 to e0+N: slot (e0+N) % 64 checked. THIS IS THE BOOST SLOT.

So at the advance_epoch from e0+N-1 to e0+N, the boost is moved to due. After this advance, dist_epoch = e0+N, boosts_due = 1.

So after the (N-1)th distribute (at e0+N-1), the boost is in due.

But the boost was supposed to apply for N distributes! Including the Nth one at e0+N.

Hmm but the Nth distribute can't happen because BoostsExpireFirst fires.

Wait this is the bug! The boost is supposed to apply for N distributes, but only applies for N-1 (because the slot check moves it to due before the Nth distribute happens).

Hmm let me re-verify. Boost bought at e0. end = e0+N. Slot (e0+N) % 64.

Distributes happen at e0+1, e0+2, ..., e0+N.

Each distribute: BoostsExpireFirst check. Then credit uses boost. Then advance_epoch.

So:
- Distribute at e0+1: BoostsExpireFirst pass. credit. advance_epoch. dist_epoch = e0+2. Slot (e0+2) % 64 checked. Not boost slot.
- Distribute at e0+2: same. dist_epoch = e0+3.
- ...
- Distribute at e0+N-1: BoostsExpireFirst pass. credit. advance_epoch. dist_epoch = e0+N. Slot (e0+N) % 64 checked. THIS IS BOOST SLOT. Moved to due.
- Distribute at e0+N: BoostsExpireFirst: pass (boosts_due was 0 before this distribute). Wait no.

Hmm wait, when is BoostsExpireFirst checked? At the START of distribute. So when distribute at e0+N is called, BoostsExpireFirst is checked.

If at distribute at e0+N-1, advance_epoch moved dist_epoch to e0+N and moved the boost to due. Then distribute at e0+N starts with boosts_due = 1.

But wait, distribute at e0+N can only be called from the OUTSIDE (a separate transaction or later in the same tx). If it's in the SAME tx as the boost purchase and the N-1 distributes, then... hmm.

Actually let me re-think. The advance_epoch from e0+N-1 to e0+N happens DURING the distribute at e0+N-1. After that advance, dist_epoch = e0+N. The NEXT distribute is at dist_epoch = e0+N.

If the next distribute is in the same tx (somehow), BoostsExpireFirst checks boosts_due = 1, refuses.

If the next distribute is in a different tx, BoostsExpireFirst checks boosts_due = 1, refuses.

So the (N+1)th distribute would be refused.

But the design says the boost should apply for N distributes. The first N distributes starting from K+1 (where K is purchase epoch). That's K+1, K+2, ..., K+N. N distributes.

In my trace:
- Distribute at K+1: 1st.
- ...
- Distribute at K+N-1: (N-1)th.
- After this, advance_epoch moved boost to due.
- Distribute at K+N: (N)th. But BoostsExpireFirst refuses!

So actually only N-1 distributes apply the boost. The Nth one is refused.

Hmm that's an off-by-one bug.

But the test BO.21 expects N distributes. Let me re-verify the test setup.

In BO.21:
- [boost, distribute] in one tx.
- Boost first.
- Distribute second.

So boost is bought at dist_epoch = e0. Then distribute uses boost. Advance to e0+1.

Then 1 exactDist runs.

exactDist at dist_epoch = e0+1. BoostsExpireFirst: pass (boosts_due = 0, since the slot hasn't been checked yet). credit. advance to e0+2. Slot (e0+2) checked.

For BE = 2: slot (e0+2) % 64 = (e0+BE) % 64. THIS IS BOOST SLOT. Moved to due.

So after 1 exactDist (2nd distribute), boosts_due = 1.

So 2 distributes applied the boost: in-tx at e0 (1st), exactDist at e0+1 (2nd).

For BE = 2: 2 distributes = BE distributes. ✓

Now what about BE = 5?

[boost, distribute] at e0. Boost first, end = e0+5.
In-tx distribute at e0 uses boost. advance to e0+1.

Then 5 exactDists at e0+1, e0+2, e0+3, e0+4, e0+5.

Wait, the loop is `for(let i=0;i<BE;i++)`. So BE = 5 iterations. Each iteration does 1 exactDist.

After 1st exactDist at e0+1: advance to e0+2. Slot (e0+2) checked.
After 2nd at e0+2: advance to e0+3. Slot (e0+3) checked.
After 3rd at e0+3: advance to e0+4. Slot (e0+4) checked.
After 4th at e0+4: advance to e0+5. Slot (e0+5) checked. THIS IS BOOST SLOT. Moved to due.
After 5th at e0+5: BoostsExpireFirst: pass? No, boosts_due = 1. REFUSED.

So 5th exactDist would fail. The test would fail.

Hmm but the test only does 1 exactDist:
```typescript
await exactDist(3n)
rec('BO.21a','...and ONE more makes it due: it earned exactly N (the one it rode in on counts), not N+1','1',String((await bc()).due))
```

So just 1 exactDist. For BE = 2: that's enough. For BE = 5: NOT enough.

Hmm wait, the comment "ONE more makes it due: it earned exactly N (the one it rode in on counts), not N+1" suggests that after N distributes (where the first is the in-tx), the boost is due.

For BE = 2: in-tx + 1 exactDist = 2 distributes total = BE. Boost due.

For BE = 3: in-tx + 1 exactDist = 2 distributes. Not BE yet. Boost NOT due. The test only does 1 exactDist, so the test wouldn't assert "due".

Hmm but the test is parameterized by BE (default 2). Let me check what BE is.

Looking at the suite code:
```typescript
const BW=2, BE=2, PRICE_CBOB=2_000_000_000n
```

So BE = 2. The test uses BE = 2.

For BE = 2, 1 exactDist is enough. ✓

For BE = 5, 1 exactDist is NOT enough. The comment is misleading.

But wait, the test ONLY uses BE = 2. So the test doesn't actually verify BE = 5 works correctly. There's no test for BE > 2 in BO.21.

Let me check if there's any test for BE > 2.

Looking at the suite:
- BO.34 tests C2 (the ring wrap with MAX_BOOST_EPOCHS = 63).
- BO.35 tests [distribute, boost] in one tx, with BE = 2.
- BO.21 tests [boost, distribute] in one tx, with BE = 2.

Hmm so BE = 2 is tested. What about other values?

Hmm BO.34 does use MAX_BOOST_EPOCHS which is 63. Let me check:

```typescript
const v3=await propose(actBoost(1_000_000_000n,2,MAX_BOOST_EPOCHS)); await waitEnds(v3.ends); await exec(v3.id)
let guard=0
while(Number((await bc()).epoch % BigInt(BOOST_RING))<BOOST_RING-MAX_BOOST_EPOCHS+1 && guard++<80) await step(1n)
const Wv=(await freeV())!, e0=(await bc()).epoch
await send([ixBoost(Wv,alice,{minE:MAX_BOOST_EPOCHS})],[alice])
const end=(await recB(Wv)).end
rec('BO.34','C2: a boost bought at epoch '+e0+' (ring slot '+(e0%64n)+') ends at a slot that WRAPS past 64',
  'true',String(end%64n<e0%64n),`end ${end}, slot ${end%64n}`)
```

So boost with N = MAX_BOOST_EPOCHS = 63. After the boost, ring slot wraps past 64. The test checks that the slot wraps.

But it doesn't verify that the boost applies for exactly N distributes. It just checks the slot wraps.

Hmm OK so the test doesn't catch the off-by-one bug for BE > 2.

Wait, but if my analysis is correct, the boost applies for N-1 distributes when bought between distributes, and N distributes when bought in same tx as distribute.

Hmm let me think about this more carefully.

For the test BO.34:
- After the boost, the test does:
```typescript
for(let i=1;i<MAX_BOOST_EPOCHS;i++){ await step(1n)
  if(i===3){ const c0=await bc(), s0=await ringAt(slot2)
    const rr=await bare(W2)
    const c1=await bc(), s1=1
    rec('BO.38','N1: that second wrapped boost (end '+end2+', ring slot '+2'...'),`...`,`${end2===end},${c0.epoch<end2},${rr.ok?'ALLOW':'REJECT'},${s1},${c1.active},${c1.due}`,rr.err)
    rec('BO.38a','...and the books balance, the ring included',BOOKS,await books()) } }
const before=await recB(Wv)
rec('BO.34a','...after N-1 distributions it is still live and not due','true',String(before.w===2&&(await bc()).epoch===end-1n))
await expireDue(); await exactDist(1n)
const c=await bc()
rec('BO.34b','...the Nth makes it DUE, at exactly its end epoch','true',String(c.epoch===end&&c.due>=1))
```

So BO.34a says "after N-1 distributions it is still live and not due". Then BO.34b says "the Nth makes it DUE".

So the test verifies that after N-1 distributes, boost is still active. After N distributes, boost is due.

For N = MAX_BOOST_EPOCHS = 63, the test runs MAX_BOOST_EPOCHS - 1 = 62 step(1n) calls. Then expireDue. Then exactDist(1n).

step(1n) presumably advances epoch by 1.

Hmm let me check what step(1n) does. Looking at the suite code:

```typescript
const step=async(k=2n)=>{await expireDue(); const kk=await exactDist(k); await expireDue(); return kk}
```

So step calls exactDist(k) with k=2n. exactDist(k) does:
```typescript
const exactDist=async(k:bigint)=>{await joinWaiting(); const p=await pool(); await top(k*p.w+(p.w-(p.avail%p.w))%p.w)
  const q=await pool(); await send([ixDistribute(burnBy(alice))],[alice]); return q.avail/q.w}
```

So exactDist calls distribute(2) (burn path).

So step calls distribute.

Hmm but step passes k=2n to exactDist. And exactDist uses k as the multiplier for the top amount. The distribute is the standard `ixDistribute(burnBy(alice))`.

So step = 1 distribute.

For BO.34: 62 step calls (i=1 to 62), then expireDue, then exactDist(1n) (1 distribute). Total 63 distributes.

So the test verifies that after 63 distributes (which equals MAX_BOOST_EPOCHS), the boost is due.

But the boost was bought at... let me re-trace.

After propose, exec, expireDue (closes any due boosts), the loop runs:
```typescript
while(Number((await bc()).epoch % BigInt(BOOST_RING))<BOOST_RING-MAX_BOOST_EPOCHS+1 && guard++<80) await step(1n)
```

So step is called until epoch % 64 < 64 - 63 + 1 = 2. I.e., until epoch % 64 < 2 (so epoch % 64 is 0 or 1).

This is so the boost bought in the next step will have end that WRAPS.

So when this loop exits, epoch % 64 is 0 or 1.

Then `await send([ixBoost(Wv,alice,{minE:MAX_BOOST_EPOCHS})],[alice])`. Boost bought at current epoch.

Let e0 = current epoch. e0 % 64 is 0 or 1.

end = e0 + 63 = e0 + 63.

Slot (e0 + 63) % 64. For e0 % 64 = 0: slot = 63. For e0 % 64 = 1: slot = 0. Either way, slot wraps.

Now the test runs:
```typescript
for(let i=1;i<MAX_BOOST_EPOCHS;i++){ await step(1n)
  if(i===3){ ... } }
```

This runs step 62 times (i=1 to 62).

Each step is 1 distribute. So 62 distributes.

After 62 distributes: dist_epoch = e0 + 62.

end = e0 + 63. So dist_epoch < end.

The boost should still be active.

Then:
```typescript
const before=await recB(Wv)
rec('BO.34a','...after N-1 distributions it is still live and not due','true',String(before.w===2&&(await bc()).epoch===end-1n))
```

So after 62 distributes (N-1 = 63-1 = 62), the boost is still active. dist_epoch = e0 + 62 = end - 1.

Then:
```typescript
await expireDue(); await exactDist(1n)
const c=await bc()
rec('BO.34b','...the Nth makes it DUE, at exactly its end epoch','true',String(c.epoch===end&&c.due>=1))
```

After expireDue and exactDist(1n): 63rd distribute. dist_epoch = e0 + 63 = end. boost due.

So the test verifies that after N distributes (63), boost is due.

But wait, in my earlier analysis, only N-1 distributes should apply the boost (with the slot check moving the boost to due before the Nth distribute).

For N = 63:
- Boost bought at e0.
- Distributes at e0+1, e0+2, ..., e0+63. That's 63 distributes.
- After distribute at e0+62 (62nd distribute), advance to e0+63. Slot (e0+63) % 64 checked. THIS IS THE BOOST SLOT. Boost moved to due.
- After this, dist_epoch = e0+63 = end.
- Distribute at e0+63 (63rd distribute): BoostsExpireFirst: pass (boosts_due = 1, fails). REFUSED.

Hmm but the test expects the boost to be applied for 63 distributes. Let me re-read the test:

```typescript
const before=await recB(Wv)
rec('BO.34a','...after N-1 distributions it is still live and not due','true',String(before.w===2&&(await bc()).epoch===end-1n))
await expireDue(); await exactDist(1n)
const c=await bc()
rec('BO.34b','...the Nth makes it DUE, at exactly its end epoch','true',String(c.epoch===end&&c.due>=1))
```

After the loop (62 distributes), `await recB(Wv)` checks Wv's record. boost_weight === 2.

recB returns:
```typescript
const recB=async(v:v)=>{const r=(await recOf(v.asset))!
  return {w:r[OFF_REC_BOOST_W],end:r.readBigUInt64LE(OFF_REC_BOOST_END),carry:u128le(r,OFF_REC_CARRY),base:WEIGHTS[r[OFF_REC_LEVEL]-1]}}
```

So boost_weight is the current value.

For `before.w === 2`: the boost weight is still 2 (not yet expired).

So after 62 distributes, the boost is still active. After 63 distributes, the boost is in due (c.due >= 1).

But the test doesn't check whether the 63rd distribute actually applies the boost. It just checks that the boost is in due.

Hmm so the test doesn't verify that the boost was applied for N distributes. It just verifies that the boost is in due after N distributes.

Hmm. So my concern about off-by-one might be wrong, or the test doesn't catch it.

Let me look at the test BO.21 again to see how the "the one it rode in on counts" is checked:

```typescript
{ await joinWaiting(); const p=await pool(); await top(p.w+(p.w-(p.avail%p.w))%p.w)
  const e0=(await bc()).epoch
  const one=await att(()=>send([ixBoost(X,alice),ixDistribute(burnBy(alice))],[alice]))
  const rx=await recB(X), c1=await bc()
  rec('BO.21','a boost and a distribution in ONE transaction land; the boost ends N distributions after the epoch it was bought in',
    `ALLOW,${e0+BigInt(BE)},${e0+1n}`,`${one.ok?'ALLOW':'REJECT'},${rx.end},${c1.epoch}`,one.err)
  await exactDist(3n)
  rec('BO.21a','...and ONE more makes it due: it earned exactly N (the one it rode in on counts), not N+1','1',String((await bc()).due))
  await send([ixExpire([X])],[alice]); await claimAll(LIVE2.filter(v=>v!==Q)) }
```

So after the in-tx + 1 exactDist (2 distributes total for BE=2), boosts_due == 1.

If the off-by-one were real, then:
- In-tx at e0: credit with boost. advance to e0+1. Slot (e0+1) checked. Not boost slot.
- exactDist at e0+1: credit with boost. advance to e0+2. Slot (e0+2) checked. THIS IS BOOST SLOT. Moved to due.

So after 2 distributes, boosts_due = 1. The test asserts this. ✓

But the test doesn't verify that the boost was used in the distribute. It just checks boosts_due.

Hmm so if my analysis is correct that the boost is only used for N-1 distributes (not N), the test doesn't catch it because:
- For BE = 2: 1 in-tx + 1 exactDist = 2 distributes. After both, boosts_due = 1 (because the slot was checked at the 2nd distribute's advance_epoch).
- The test asserts boosts_due == 1 after 2 distributes, which matches.

But the boost was actually applied for 2 distributes (the in-tx + the exactDist). Hmm.

Wait, let me re-verify. For BE = 2:
- Boost bought at e0. end = e0+2. Slot (e0+2) % 64.
- In-tx distribute at e0: BoostsExpireFirst pass. credit uses boost. advance to e0+1. Slot (e0+1) % 64 checked. Not boost slot.
- exactDist at e0+1: BoostsExpireFirst pass (boosts_due still 0). credit uses boost. advance to e0+2. Slot (e0+2) % 64 checked. THIS IS BOOST SLOT. Moved to due.

So after 2 distributes, boosts_due = 1.

The boost was applied in both distributes. So the boost applied for 2 distributes = BE distributes. ✓

So my off-by-one concern was wrong. Let me re-verify with a longer N.

For BE = 5:
- Boost bought at e0. end = e0+5. Slot (e0+5) % 64.
- In-tx distribute at e0: credit uses boost. advance to e0+1. Slot (e0+1) checked.
- exactDist at e0+1: credit uses boost. advance to e0+2. Slot (e0+2) checked.
- exactDist at e0+2: credit uses boost. advance to e0+3. Slot (e0+3) checked.
- exactDist at e0+3: credit uses boost. advance to e0+4. Slot (e0+4) checked.
- exactDist at e0+4: credit uses boost. advance to e0+5. Slot (e0+5) checked. THIS IS BOOST SLOT. Moved to due.

So after 5 distributes (in-tx + 4 exactDists), boosts_due = 1.

So for BE = 5, 5 distributes applied the boost. Then it's in due.

Hmm so the boost IS applied for BE distributes. My off-by-one concern was wrong.

But wait, what if the boost is NOT bought in-tx? Then the first distribute is the NEXT one.

For BE = 5, boost bought BETWEEN distributes (not in any tx):
- Boost at e0. end = e0+5. Slot (e0+5) % 64.
- Distribute at e0+1: credit uses boost. advance to e0+2. Slot (e0+2) checked.
- Distribute at e0+2: credit uses boost. advance to e0+3. Slot (e0+3) checked.
- Distribute at e0+3: credit uses boost. advance to e0+4. Slot (e0+4) checked.
- Distribute at e0+4: credit uses boost. advance to e0+5. Slot (e0+5) checked. THIS IS BOOST SLOT. Moved to due.

So 4 distributes applied the boost. Then it's in due.

So in this scenario, only 4 distributes (not 5) apply the boost. The 5th is refused.

So if the boost is bought in a separate tx from 2 distributes, only 4 applies.

Hmm this IS an off-by-one bug!

But the test only uses in-tx distribute. So the bug isn't caught.

Actually wait, let me re-verify. The test BO.21 has [boost, distribute] in one tx. So the boost is bought in the same tx as the first distribute.

For BE = 5 with [boost, distribute]: in-tx at e0. After: e0+1. Then 4 exactDists (for total of 5 distributes).

But the test only does 1 exactDist. For BE = 5, that wouldn't be enough.

The test uses BE = 2 (default). For BE = 2, 1 exactDist is enough.

OK so the test verifies the timing for BE = 2 with in-tx distribute. It doesn't verify the timing for BE = 5 or for non-in-tx distribute.

Hmm so there's a potential bug for:
- BE > 2 (not tested)
- Non-in-tx distribute (not tested)

For non-in-tx, the boost applies for N-1 distributes, not N.

For in-tx, the boost applies for N distributes.

Wait but if I'm right about the off-by-one for non-in-tx, that's a real bug. Let me re-verify.

Boost bought at dist_epoch = K. (Not in any distribute tx.)

end = K + N. Slot (K + N) % 64.

Next distribute at K+1 (or later, but let's say K+1):
- BoostsExpireFirst: pass.
- credit uses boost.
- advance_epoch. dist_epoch = K+2. Slot (K+2) % 64 checked.

...

Distribute at K+N-1:
- BoostsExpireFirst: pass.
- credit uses boost.
- advance_epoch. dist_epoch = K+N. Slot (K+N) % 64 checked. THIS IS BOOST SLOT. Moved to due.

So after the (N-1)th distribute (at K+N-1), the boost is moved to due. The next distribute (at K+N) would be refused.

So the boost applied for N-1 distributes (at K+1, K+2, ..., K+N-1).

If boost was bought at K and we expect it to apply for N distributes, the actual behavior is N-1 distributes. Off-by-one.

This IS a bug.

But wait, the test BO.21 with [boost, distribute] in-tx: in-tx distribute uses boost. Then exactDists.

For in-tx: distribute at K (in-tx). BoostsExpireFirst pass. credit uses boost (boost is already in record from in-tx purchase). advance_epoch. dist_epoch = K+1. Slot (K+1) % 64 checked.

So in-tx distribute counts as the 1st distribute.

Then N-1 more distributes (at K+1, K+2, ..., K+N-1). Total N distributes.

After the N-1th (at K+N-1), advance to K+N. Slot (K+N) % 64 checked. THIS IS BOOST SLOT. Moved to due.

So for in-tx, the boost applies for N distributes.

But for non-in-tx (boost bought between distributes), the boost applies for N-1 distributes.

This is an inconsistency. The test doesn't catch it because BE = 2 with in-tx is the only scenario tested.

Hmm OK so this is a bug. Let me check if there's any other test.

Actually wait, BO.34a and BO.34b use N = MAX_BOOST_EPOCHS = 63. They test that after 62 distributes, boost is still active. After 63 distributes, boost is due.

But the boost was bought between distributes (not in-tx). So for non-in-tx, the boost should apply for 63-1 = 62 distributes. After 62 distributes, boost is due.

But the test asserts that after 62 distributes (step is run 62 times), boost is NOT yet due. Let me re-check.

Actually, BO.34a's assert is `(await bc()).epoch===end-1n`. So after 62 distributes, dist_epoch = e0 + 62 = end - 1.

For non-in-tx with N = 63:
- Boost at e0. end = e0+63.
- Distribute at e0+1: 1st. advance to e0+2. Slot (e0+2).
- ...
- Distribute at e0+62: 62nd. advance to e0+63. Slot (e0+63) = end slot. Moved to due.

So after 62 distributes, boost is in due.

But the test asserts boost is still active (weight = 2) after 62 distributes.

Hmm wait, the boost_weight is 2 until expire_boost is called. expire_boost requires dist_epoch >= boost_end_epoch. After 62 distributes, dist_epoch = e0+62 = end - 1 < end. So expire_boost refuses (BoostNotDue).

So boost_weight is still 2. But boosts_due is 1 (since slot was moved to due at advance_epoch to end).

So the test's assert `before.w === 2` passes (boost_weight still 2). And `(await bc()).epoch === end - 1n` (dist_epoch = end - 1). 

But the boost was moved to due at advance_epoch from end-1 to end. So the NEXT distribute (at end) would be refused.

So for non-in-tx with N = 63, the boost applied for 62 distributes (at e0+1 through e0+62).

The test expects this (62 distributes), and then BO.34b runs 1 more distribute (exactDist(1n)) which is at end. But this distribute is REFUSED.

Hmm but the test asserts c.epoch === end && c.due >= 1.

c.epoch = end (since the distribute at end-1 advanced to end). c.due = 1 (boost in due).

But the distribute at end was REFUSED. So the actual distribute didn't happen. But dist_epoch is end.

Hmm so the test's check `(await bc()).epoch === end` passes (dist_epoch = end). `(await bc()).due >= 1` passes (due = 1). The test "passes".

But the distribute was refused. The test doesn't check whether the distribute succeeded.

So the test doesn't verify that the boost was applied for N distributes. It only verifies that boosts_due = 1 after N distributes.

Hmm so the off-by-one bug is hidden by the test design.

Actually wait. Let me re-verify.

For BO.34, after 62 distributes, dist_epoch = e0+62. boost_weight = 2 (active). boosts_due = 1.

Then `await expireDue()` calls expire_boosts instruction. expire_boost checks:
- r.retired? No.
- r.active? Yes.
- r.boost_weight > 0? Yes.
- dist_epoch >= boost_end_epoch? dist_epoch = e0+62 = end-1. boost_end_epoch = end = e0+63. e0+62 < e0+63, so NO.

So expire_boost is SKIPPED for this vault (because boost not due yet).

Hmm so expire_boosts doesn't expire anything yet. The boost remains active (in the recording) but in due (in the bookkeeping).

Then `await exactDist(1n)`. exactDist calls distribute. distribute:
- BoostsExpireFirst: boosts_due = 1. REFUSED.

So distribute fails. The test just checks the state, which is unchanged (dist_epoch still end-1).

Hmm wait, the test asserts `c.epoch === end` after this exactDist. But if exactDist failed, dist_epoch stays at end-1.

Hmm so the test wouldn't pass?

Let me re-look:
```typescript
await expireDue(); await exactDist(1n)
const c=await bc()
rec('BO.34b','...the Nth makes it DUE, at exactly its end epoch','true',String(c.epoch===end&&c.due>=1))
```

After expireDue and exactDist, check c.epoch === end and c.due >= 1.

If exactDist failed, c.epoch = end - 1 (unchanged). c.epoch === end is false. Test fails.

So if my analysis is correct, this test should FAIL.

But the test was reportedly passing (since it was added to the suite as part of v6 stage 3c and the suite is green).

Let me re-verify my analysis. Maybe I'm wrong somewhere.

OK let me re-read advance_epoch:
```rust
fn advance_epoch(c: &mut MintConfig) -> Result<()> {
    c.dist_epoch = c.dist_epoch.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_this_epoch = 0;
    let i = (c.dist_epoch % BOOST_RING as u64) as usize;
    c.boosts_due = c.boosts_due.checked_add(c.boost_expiring[i]).ok_or(MintError::Overflow)?;
    c.boost_expiring[i] = 0;
    Ok(())
}
```

So after advance_epoch, dist_epoch is incremented. Slot (new dist_epoch) % 64 checked.

If distribute at K+N-1 calls advance_epoch: dist_epoch becomes K+N. Slot (K+N) % 64 checked. If boost was stored at (K+N) % 64, it's moved to due.

So after distribute at K+N-1, boost is moved to due.

Distribute at K+N: BoostsExpireFirst check at start. boosts_due = 1. REFUSED.

Hmm so the test should fail for non-in-tx distribute. But it was supposedly passing.

Maybe the test passes because boost was bought in-tx? Let me re-verify the test setup.

Actually wait, the test does:
```typescript
const v3=await propose(actBoost(1_000_000_000n,2,MAX_BOOST_EPOCHS)); await waitEnds(v3.ends); await exec(v3.id)
let guard=0
while(Number((await bc()).epoch % BigInt(BOOST_RING))<BOOST_RING-MAX_BOOST_EPOCHS+1 && guard++<80) await step(1n)
const Wv=(await freeV())!, e0=(await bc()).epoch
await send([ixBoost(Wv,alice,{minE:MAX_BOOST_EPOCHS})],[alice])
const end=(await recB(Wv)).end
```

So boost is sent in a separate tx. No in-tx distribute.

Hmm. Then per my analysis, the test should fail at exactDist(1n).

Maybe the boost doesn't actually expire? Let me think.

Actually wait, let me re-check the timing. Maybe the ring slot is computed from a different epoch.

In `boost_vault`:
```rust
let end = c.dist_epoch.checked_add(epochs as u64).ok_or(MintError::Overflow)?;
let i = (end % BOOST_RING as u64) as usize;
c.boost_expiring[i] = c.boost_expiring[i].checked_add(1).ok_or(MintError::Overflow)?;
```

So end = dist_epoch + epochs. Slot = end % 64.

For N = 63, end = e0 + 63. Slot = (e0+63) % 64.

For e0 = 0 (just for example), end = 63, slot = 63.
For e0 = 1, end = 64, slot = 0.

OK so slot = (e0 + 63) % 64 = (e0 - 1) % 64.

Hmm interesting. For N = 63 (or any N = 64k - 1), slot = (e0 - 1) % 64. So slot is determined by e0's previous value.

Now the boost is bought at e0. Slot = (e0 - 1) % 64. Stored.

Distribute at e0+1: advance to e0+2. Slot (e0+2) checked. Not the boost slot.
...

Distribute at e0+62: advance to e0+63. Slot (e0+63) % 64 = (e0 - 1) % 64 = the boost slot. Moved to due.

So after 62 distributes from e0+1, boost is moved to due. The 63rd distribute (at e0+63) would be refused.

Hmm so for N = 63 non-in-tx, the boost applies for 62 distributes.

But the test expects after 63 distributes the boost is in due (which would be true even if the 63rd distribute was refused, as long as boosts_due was incremented).

Wait actually, let me re-check. The test asserts c.epoch === end. After the loop (62 distributes), c.epoch = e0+62 = end - 1. NOT end.

If exactDist(1n) succeeds, c.epoch = end. If it fails (BoostsExpireFirst), c.epoch = end - 1 (unchanged).

So the test fails if exactDist fails.

But the test is passing (it's part of the green suite). So exactDist must be succeeding.

Hmm. Let me re-verify the test's setup.

Oh wait, maybe the loop condition is wrong. Let me re-check:

```typescript
while(Number((await bc()).epoch % BigInt(BOOST_RING))<BOOST_RING-MAX_BOOST_EPOCHS+1 && guard++<80) await step(1n)
```

The condition is `epoch % 64 < 64 - 63 + 1 = 2`. So loop runs while epoch % 64 < 2 (i.e., epoch % 64 is 0 or 1).

For each iteration, step(1n) is called. After step, epoch advances.

Hmm wait, but the loop variable is `guard`, not `epoch`. The condition checks (await bc()).epoch % 64 < 2. So if epoch % 64 >= 2, loop exits.

But step advances epoch. After enough steps, epoch % 64 reaches >= 2.

Hmm let me think. If epoch starts at, say, 100, then after step epoch becomes 101. 101 % 64 = 37. 37 >= 2, loop exits.

So the loop exits immediately if epoch % 64 >= 2 at the start.

The intent of the loop seems to be to advance epoch until epoch % 64 is small (0 or 1). So the boost bought NEXT will have an end that wraps.

So if the starting epoch is, say, 100, the loop doesn't run. Boost bought at 100. end = 100 + 63 = 163. Slot 163 % 64 = 35.

Then step is called 62 times. After 62 steps, epoch = 100 + 62 = 162.

end = 163. epoch = 162 = end - 1.

So at this point, boost is active, slot is 35.

After 62 steps, advance_epochs have happened. Each checks slot ((current_epoch + 1) % 64).

Hmm let me re-trace. Step 1: distribute at 100, advance to 101. Slot (101) % 64 = 37 checked.
Step 2: distribute at 101, advance to 102. Slot 38 checked.
...
Step 62: distribute at 161, advance to 162. Slot 162 % 64 = 34 checked.

So slots 37 through 34 are checked. Not slot 35.

Hmm so slot 35 is NOT checked. So boost (at slot 35) is NOT moved to due.

So after 62 distributes, boosts_due = 0 (slot 35 not yet checked).

Then exactDist(1n): distribute at 162, advance to 163. Slot 163 % 64 = 35 checked. THIS IS BOOST SLOT. Moved to due.

So after the 63rd distribute, boosts_due = 1.

So for non-in-tx with N = 63, the boost applied for 63 distributes (at 101, 102, ..., 163). After all 63, boost is moved to due.

Hmm so my analysis was wrong! Let me re-verify.

Oh wait, I made an error. Let me recount.

Boost bought at dist_epoch = 100 (let's say). end = 100 + 63 = 163. Slot 163 % 64 = 35.

Now distributes happen. The 1st distribute is at some dist_epoch. Let's say the test loop starts with epoch = 100.

Step 1: distribute at epoch = 100. advance to 101. Slot 101 % 64 = 37 checked.

Wait, this is BEFORE the boost was bought (if loop runs first, then boost bought after).

Hmm let me re-look at the test setup:

```typescript
const v3=await propose(actBoost(1_000_000_000n,2,MAX_BOOST_EPOCHS)); await waitEnds(v3.ends); await exec(v3.id)
let guard=0
while(Number((await bc()).epoch % BigInt(BOOST_RING))<BOOST_RING-MAX_BOOST_EPOCHS+1 && guard++<80) await step(1n)
const Wv=(await freeV())!, e0=(await bc()).epoch
await send([ixBoost(Wv,alice,{minE:MAX_BOOST_EPOCHS})],[alice])
const end=(await recB(Wv)).end
```

So:
1. propose, exec.
2. Run step until epoch % 64 < 2.
3. Get free vault Wv.
4. Read e0 = current epoch.
6. Send boost for Wv.
7. Read end.

So at step 6, dist_epoch = e0. Boost's end = e0 + MAX_BOOST_EPOCHS = e0 + 63.

Slot = (e0 + 63) % 64.

For e0 % 64 = 0: slot = 63.
For e0 % 64 = 1: slot = 0.

So slot is either 63 or 0.

Now the loop:
```typescript
for(let i=1;i<MAX_BOOST_EPOCHS;i++){ await step(1n)
  if(i===3){ ... } }
```

For MAX_BOOST_EPOCHS = 63, this runs step 62 times.

Each step is 1 distribute. So 62 distributes.

Distribute at e0+1: advance to e0+2. Slot (e0+2) % 64 checked.
...
Distribute at e0+62: advance to e0+63. Slot (e0+63) % 64 checked. THIS IS THE BOOST SLOT.

So after 62 distributes from e0+1 to e0+62, slot (e0+63) % 64 checked. Boost slot decremented, moved to due.

So after the loop (62 distributes), boosts_due = 1. dist_epoch = e0+63.

The test asserts `before.w === 2` (boost still active). But unschedule_boost in expire_boost requires the boost to be due. Since the boost is in due (depositable) but not yet expired via the on-chain expire_boost path, the boost_weight remains 2.

So the test passes this assertion.

Then `await expireDue()` calls expire_boosts instruction:
```typescript
await send([ixExpire([W2])],[alice])
```

But wait, in the test code, the expire_boosts is only for W2 (the second wrapped boost), not Wv.

Let me look at the full code:

```typescript
const before=await recB(Wv)
rec('BO.34a','...after N-1 distributions it is still live and not due','true',String(before.w===2&&(await bc()).epoch===end-1n))
await expireDue(); await exactDist(1n)
const c=await bc()
rec('BO.34b','...the Nth makes it DUE, at exactly its end epoch','true',String(c.epoch===end&&c.due>=1))
```

`await expireDue()` is a top-level function call. Looking at:

```typescript
const expireDue=async()=>{const e=(await bc()).epoch, due:V[]=[]
  for(const v of VAULTS){const r=await recOf(v.asset)
    if(r&&r[OFF_REC_ACTIVE]&&!r[OFF_REC_RETIRED]&&r[OFF_REC_BOOST_W]&&r.readBigUInt64LE(OFF_REC_BOOST_END)<=e) due.push(v)}
  for(let i=0;i<due.length;i+=20) await send([ixExpire(due.slice(i,i+20))],[alice]); return due.length}
```

So expireDue finds vaults with boost_end_epoch <= current_epoch (boost due), and calls expire_boosts instruction on them.

For Wv: boost_end_epoch = end = e0+63. current_epoch after the loop = e0+63. So boost_end_epoch <= current_epoch. So Wv is in due list.

So expireDue calls ixExpire with Wv. expire_boosts:
```rust
if r.retired || !r.active || r.boost_weight == 0 || ctx.accounts.config.dist_epoch < r.boost_end_epoch {
    continue;
}
expire_boost(&mut ctx.accounts.config, &mut r)?;
```

For Wv at epoch = e0+63:
- r.retired? No.
- r.active? Yes.
- r.boost_weight > 0? Yes.
- dist_epoch >= boost_end_epoch? e0+63 >= e0+63. Yes.

So expire_boost is called. unschedule_boost:
- dist_epoch >= boost_end_epoch. Yes. Decrement boosts_due. boosts_due = 1 - 1 = 0.

Then reweigh(0). The vector returned to the loop.

So after expireDue, boosts_due = 0. And boost_weight = 0 (via reweigh).

Then `await exactDist(1n)`. exactDist calls distribute:
- BoostsExpireFirst: pass (boosts_due = 0).
- credit. advance_epoch.

So distribute succeeds.

After exactDist: dist_epoch = e0+63+1 = end + 1. Wait that's not what the test asserts.

The test asserts `c.epoch === end && c.due >= 1`. But after the test's exactDist, c.epoch should be end + 1 (not end).

Hmm so the test's assert wouldn't pass.

Wait let me re-check. Maybe the expireDue in the test doesn't actually call expire_boosts for Wv.

Actually let me look at the order of operations in the loop:

```typescript
for(let i=1;i<MAX_BOOST_EPOCHS;i++){ await step(1n)
  if(i===3){ const c0=await bc(), s0=await ringAt(slot2)
    const rr=await bare(W2)
    const c1=await bc(), s1=1
    rec('BO.38','N1: that second wrapped boost (end '+end2+', ring slot '+2'...'),`...`,`${end2===end},${c0.epoch<end2},${rr.ok?'ALLOW':'REJECT'},${s1},${c1.active},${c1.due}`,rr.err)
    rec('BO.38a','...and the books balance, the ring included',BOOKS,await books()) } }
```

OK so during the loop, at i=3 (after 3 distributes), bare W2 (the second wrapped boost). W2 has a different end (end2). The bare burn and retire removes W2 from the schedule.

So W2's boost is ret-burned and retired. Its boost slot is decremented (by expireBoost inside retire).

Hmm OK that's a different scenario. Let me re-read.

OK so the loop runs 62 distributes. During the loop at i=3, W2 is bare-burned.

After the loop (62 distributes), the test checks `before.w === 2` for Wv (not W2). So Wv's boost is still active.

Then expireDue: if Wv is in due, expire it.

But Wv's boost_end_epoch = end = e0+63. After 62 distributes, dist_epoch = e0+63. So boost_end_epoch <= current_epoch. Wv is in due.

But maybe Wv is NOT in due because of the ring slot check timing. Let me re-think.

After 62 distributes from e0+1 to e0+62, dist_epoch = e0+63.

But the slot check happens in advance_epoch. Each advance_epoch checks slot (new dist_epoch) % 64.

So at the last advance_epoch (from e0+62 to e0+63), slot (e0+63) % 64 = (e0+63) % 64 = the boost slot. Decremented. Moved to due.

So boosts_due = 1 after the loop. Then expireDue expires Wv. boosts_due = 0.

Then exactDist(1n) calls distribute. Distribute advances to e0+64. Slot (e0+64) % 64 checked.

c.epoch after = e0+64. c.epoch === end? e0+64 === e0+63? No.

Hmm so the test asserts c.epoch === end, but it's actually e0+64. Test fails.

Hmm so this is confusing. Let me actually look at the test log to see what happens.

Actually wait, I don't have access to the test log. But the test is reportedly passing.

Maybe I'm wrong about the ring slot computation. Let me re-verify.

Actually, let me check if MAX_BOOST_EPOCHS = 63 is what I think.

Looking at MINT source:
```rust
const MAX_BOOST_EPOCHS_BOUND: u16 = (BOOST_RING - 1) as u16;
```

So MAX_BOOST_EPOCHS_BOUND = 64 - 1 = 63. OK.

Hmm so my analysis seems right but the test is passing. Maybe I'm missing something.

Let me look at the test code again very carefully:

```typescript
// ROUND 25 (N1): a SECOND boost bought in the same epoch (so its end slot also overlaps), bare-burned and retired three distributions later, BEFORE it is due:
{
  const v3=await propose(actBoost(1_000_000_000n,2,MAX_BOOST_EPOCHS)); await waitEnds(v3.ends); await exec(v3.id)
  let guard=0
  while(Number((await bc()).epoch % BigInt(BOOST_RING))<BOOST_RING-MAX_BOOST_EPOCHS+1 && guard++<80) await step(1n)
  const Wv=(await freeV())!, e0=(await bc()).epoch
  await send([ixBoost(Wv,alice,{minE:MAX_BOOST_EPOCHS})],[alice])
  const end=(await recB(Wv)).end, slot2=Number(end%BigInt(BOOST_RING))
  const ringAt=async(i:number)=>(await cfg()).readUInt32LE(OFF_BOOST_RING+4*i)
  for(let i=1;i<MAX_BOOST_EPOCHS;i++){ await step(1n)
    if(i===3){ const c0=await bc(), s0=await ringAt(slot2)
      const rr=await bare(W2)
      const c1=await bc(), s1=1
      rec('BO.38','N1: that second wrapped boost (end '+end2+', ring slot '+2+'), bare-burned and retired at epoch '+c0.epoch+', BEFORE it is due: ITS slot falls by exactly one, due is untouched',
        `true,true,ALLOW,${s0-1},${c0.active-1},${c0.due}`,`${end2===end},${c0.epoch<end2},${rr.ok?'ALLOW':'REJECT'},${s1},${c1.active},${c1.due}`,rr.err)
      rec('BO.38a','...and the books balance, the ring included',BOOKS,await books()) } }
  const before=await recB(Wv)
  rec('BO.34a','...after N-1 distributions it is still live and not due','true',String(before.w===2&&(await bc()).epoch===end-1n))
  await expireDue(); await exactDist(1n)
  const c=await bc()
  rec('BO.34b','...the Nth makes it DUE, at exactly its end epoch','true',String(c.epoch===end&&c.due>=1))
  await expireDue(); const c2=await bc()
  rec('BO.34c','...and once expired the books balance, the ring included',BOOKS,await books()) }
```

OK so after 62 distributes from e0+1 to e0+62, the test asserts:
- before.w === 2 (boost still active).
- (await bc()).epoch === end-1n (dist_epoch = end - 1 = e0 + 62).

For e0 = 0, end = 63, dist_epoch after loop = 62 = end - 1. ✓
For e0 = 1, end = 64, dist_epoch after loop = 63 = end. Hmm not end-1.

Wait, the loop runs while epoch % 64 < 2. So if e0 = 0, the loop doesn't run (epoch % 64 = 0 < 2, but the loop runs while the condition is true, and after step, epoch changes).

Hmm let me re-read. The loop condition:
```typescript
while(Number((await bc()).epoch % BigInt(BOOST_RING))<BOOST_RING-MAX_BOOST_EPOCHS+1 && guard++<80) await step(1n)
```

`BOOST_RING-MAX_BOOST_EPOCHS+1` = 64 - 63 + 1 = 2.

So loop runs while epoch % 64 < 2.

Initial epoch: some value. Let's say 0.
Condition: 0 % 64 = 0 < 2. True. Run step.
Step 1: epoch advances. Now epoch = 1.
Check condition: 1 < 2. True. Run step.
Step 2: epoch = 2. Check: 2 < 2. False. Exit loop.

So after the loop, epoch = 2. So e0 = 2.

Hmm interesting. So e0 is always 2 (after the loop).

Then:
- Boost bought at e0 = 2. end = 2 + 63 = 65. Slot = 65 % 64 = 1.

Then 62 distributes (i=1 to 62):
- Distribute at 3: advance to 4. Slot 4 checked.
- Distribute at 4: advance to 5. Slot 5 checked.
- ...
- Distribute at 64: advance to 65. Slot 65 % 64 = 1 checked. THIS IS BOOST SLOT. Moved to due.

After 62 distributes, dist_epoch = 65 = end. boosts_due = 1.

Hmm so the test asserts c.epoch === end - 1n (i.e., dist_epoch = 64 = end - 1). But after 62 distributes, dist_epoch = 65 = end.

Hmm so the test would fail at BO.34a.

Wait let me re-count. The loop is:
```typescript
for(let i=1;i<MAX_BOOST_EPOCHS;i++){ await step(1n) ...}
```

MAX_BOOST_EPOCHS = 63. So i goes from 1 to 62. That's 62 iterations.

In each iteration, step is called. step = 1 distribute. So 62 distributes.

Each distribute advances epoch by 1.

So 62 distributes advance epoch by 62.

If e0 = 2 (start of the loop), after 62 distributes, epoch = 2 + 62 = 64 = end - 1.

So (await bc()).epoch === end - 1n = 64 === end - 1 = 65 - 1 = 64. ✓

OK so the test asserts (await bc()).epoch === end - 1n = 64. dist_epoch after 62 distributes = 64 = end - 1. ✓

So my counting was off. Let me recount.

Loop: i = 1 to 62. That's 62 iterations. 62 distributes. epoch advances by 62. After: 2 + 62 = 64. ✓

Now the boost's end = 65. Slot = 65 % 64 = 1.

Distribute at 3: advance to 4. Slot 4 checked.
Distribute at 4: advance to 5. Slot 5 checked.
...
Distribute at 64: advance to 65. Slot 65 % 64 = 1 checked. Boost slot 1 decremented. Moved to due.

So at distribute 64 (the last in the loop), boost is moved to due.

Then expireDue: boost is due. expire_boost runs. boosts_due decremented to 0.

Then exactDist(1n): distribute at 65. BoostsExpireFirst pass. credit. advance to 66.

So after exactDist, epoch = 66 = end + 1.

But the test asserts `c.epoch === end`. 66 === 65? No.

Hmm so the test would fail at BO.34b.

Unless... wait, maybe expireDue didn't expire Wv because old expire_boosts check failed for some reason?

Let me check expire_boosts:
```rust
if r.retired || !r.active || r.boost_weight == 0 || ctx.accounts.config.dist_epoch < r.boost_end_epoch {
    continue;
}
expire_boost(&mut ctx.accounts.config, &mut r)?;
```

For Wv at dist_epoch = 65 (after loop):
- r.retired? No.
- r.active? Yes.
- r.boost_weight > 0? Yes (2).
- dist_epoch >= boost_end_epoch? 65 >= 65. Yes.

So expire_boost is called.

unschedule_boost:
```rust
if c.dist_epoch >= r.boost_end_epoch {
    c.boosts_due = c.boosts_due.checked_sub(1).ok_or(MintError::Overflow)?;
}
```

dist_epoch = 65 = boost_end_epoch. So 65 >= 65, yes. Decrement.

So boosts_due = 1 - 1 = 0. 

Hmm so my analysis: boost expires, boosts_due = 0. Then exactDist: BoostsExpireFirst pass. credit. advance to 66. dist_epoch = 66.

The test asserts `c.epoch === end && c.due >= 1`.

c.epoch = 66 (after exactDist). end = 65. 66 === 65? No.

So the test would fail.

Hmm so my analysis must be wrong somewhere. Let me think more carefully.

Wait maybe expireDue actually advances the epoch somehow? Let me check.

expireDue is just:
```typescript
const expireDue=async()=>{const e=(await bc()).epoch, due:V[]=[]
  for(const v of VAULTS){const r=await recOf(v.asset)
    if(r&&r[OFF_REC_ACTIVE]&&!r[OFF_REC_RETIRED]&&r[OFF_REC_BOOST_W]&&r.readBigUInt64LE(OFF_REC_BOOST_END)<=e) due.push(v)}
  for(let i=0;i<due.length;i+=20) await send([ixExpire(due.slice(i,i+20))],[alice]); return due.length}
```

So it reads current epoch, finds due vaults, calls ixExpire instruction for each batch. No epoch advance.

And ixExpire instruction is `expire_boosts`. Looking at MINT source:
```rust
pub fn expire_boosts<'info>(ctx: Context<'_, '_, '_, 'info, ExpireBoosts<'info>>) -> Result<()> {
    let rem = ctx.remaining_accounts;
    require!(!rem.is_empty() && rem.len() <= MAX_EXPIRE_BATCH, MintError::BadClaimList);
    let mut n = 0u32;
    for ri in rem.iter() {
        require!(ri.is_writable, MintError::BadVaultRecord);
        let mut r = load_record(ri)?;
        if r.retired || !r.active || r.boost_weight == 0 || ctx.accounts.config.dist_epoch < r.boost_end_epoch {
            continue;
        }
        expire_boost(&mut ctx.accounts.config, &mut r)?;
        store_record(ri, &r)?;
        n += 1;
    }
    msg!("CBOB_BOOSTS_EXPIRED n={} due_left={}", n, ctx.accounts.config.boosts_due);
    Ok(())
}
```

So it iterates, finds due boosts, calls expire_boost, stores. No epoch advance.

Hmm so expireDue doesn't advance epoch.

So my analysis should be correct. The test should fail.

Unless... the loop runs more iterations than I thought.

Wait let me re-look at the loop:
```typescript
for(let i=1;i<MAX_BOOST_EPOCHS;i++){ await step(1n)
  if(i===3){ ... } }
```

MAX_BOOST_EPOCHS = 63. So i goes 1, 2, ..., 62. 62 iterations.

Each iteration is 1 step = 1 distribute. So 62 distributes.

OK that's what I had.

Let me actually try to run this in my head more carefully. Initial epoch = 2.

Iteration i=1:
- step(1n). distribute at 2. advance to 3. Slot 3 % 64 = 3 checked. Not 1.
Iteration i=2:
- step(1n). distribute at 3. advance to 4. Slot 4 % 64 = 4 checked. Not 1.
Iteration i=3:
- step(1n). distribute at 4. advance to 5. Slot 5 checked. Not 1.
- bare W2.
...
Iteration i=62:
- step(1n). distribute at 63. advance to 64. Slot 64 % 64 = 0 checked. Not 1.

After 62 iterations, epoch = 2 + 62 = 64.

Test asserts `(await bc()).epoch === end - 1n`. end = 65. end - 1 = 64. epoch = 64. ✓

But the boost slot (1) was NEVER checked! Because the slot check increments (from 3, 4, 5, ..., 0) but skips 1 and 2.

Hmm so the boost is NOT moved to due!

So boosts_due = 0 after the loop. Boost_weight is still 2 (no expire_boost called).

Then expireDue: looks for vaults with boost_end_epoch <= current epoch. Wv has end = 65. current epoch = 64. 65 > 64, so Wv is NOT in due list. expireDue does nothing.

Then exactDist(1n): distribute at 64. BoostsExpireFirst pass (boosts_due = 0). credit. advance to 65. Slot 65 % 64 = 1 checked. THIS IS BOOST SLOT. Moved to due.

After exactDist, epoch = 65 = end. boosts_due = 1.

So `c.epoch === end` ✓ (65 === 65). `c.due >= 1` ✓ (1 >= 1).

Great so the test passes.

OK so my earlier analysis was wrong because I miscounted the iterations. The boost is applied for 63 distributes (at 3, 4, ..., 65), not 62.

Let me recount. epoch starts at 2. After 62 distributes, epoch = 64. Then 1 more distribute (exactDist), epoch = 65. Slot 65 % 64 = 1 checked.

Wait that's 63 distributes. So the boost applies for 63 distributes. Which is N. ✓

Hmm so the boost does apply for N distributes. My off-by-one concern was wrong.

Let me re-verify by counting for BE = 5:

Initial epoch = some value (say e0).

Iterate step until epoch % 64 < 2 (in BO.34).

For BO.34 with N = 63, the loop iterates until epoch % 64 < 2. After the loop, epoch = 2 or 63.

Wait, what if the initial epoch is 100? Then 100 % 64 = 36. 36 >= 2. Loop doesn't run.

So boost bought at 100. end = 163. Slot = 163 % 64 = 35.

Then the loop runs 62 iterations. After: epoch = 162.

62 distributes: at 101, 102, ..., 162. 62 distributes.

Each distribute advances epoch. Slot checked: (101 % 64, 102 % 64, ..., 163 % 64).

Wait, advance_epoch from X to X+1 checks slot X+1. So distributes at 101, 102, ..., 162 advance to 102, 103, ..., 163. Slots checked: 102, 103, ..., 163.

In mod 64: 102 % 64 = 38, 103 % 64 = 39, ..., 163 % 64 = 35.

So slots checked: 38, 39, 40, 41, ..., 63, 0, 1, ..., 35. (Going from 38 through 35 mod 64.)

That's 38 to 63 = 26 slots, then 0 to 35 = 36 slots. Total 62 slots. None is slot 35.

Hmm wait, slot 35 IS in the range (it's at the end). Let me recount.

Distribute at 101: advance to 102. Slot 102 % 64 = 38.
...
Distribute at 102: advance to 103. Slot 39.
...
Distribute at 127: advance to 128. Slot 128 % 64 = 0.
Distribute at 128: advance to 129. Slot 1.
Distribute at 129: advance to 130. Slot 2.
...
Distribute at 162: advance to 163. Slot 163 % 64 = 35.

So slots checked: 38, 39, 40, ..., 63, 0, 1, 2, 3, ..., 35. That's 35 - 38 + 1 + 64 - 36 + 1 = ... let me just count.

From 38 to 63: that's 63 - 38 + 1 = 26 slots.
From 0 to 35: that's 35 - 0 + 1 = 36 slots.
Total: 26 + 36 = 62 slots. ✓ (Matches the 62 distributes.)

So slot 35 IS checked. Specifically at the LAST distribute (at 162, advance to 163).

So boost slot 35 IS decremented. Moved to due.

So after the 62 distributes, boosts_due = 1. dist_epoch = 163 = end.

Then expireDue expires Wv. boosts_due = 0. boost_weight = 0.

Then exactDist(1n): distribute at 163. BoostsExpireFirst pass (boosts_due = 0). credit. advance to 164. Slot 164 % 64 = 36 checked. Not boost slot.

After exactDist, epoch = 164 = end + 1. Test asserts c.epoch === end = 163. False!

Hmm so this would fail.

But the test was supposedly passing. Let me think more carefully.

Oh wait, maybe the initial epoch is not 100. Maybe it's already small (e.g., 2 or 63).

Looking at the test setup more carefully:
```typescript
const v3=await propose(actBoost(1_000_000_000n,2,MAX_BOOST_EPOCHS)); await waitEnds(v3.ends); await exec(v3.id)
let guard=0
while(Number((await bc()).epoch % BigInt(BOOST_RING))<BOOST_RING-MAX_BOOST_EPOCHS+1 && guard++<80) await step(1n)
```

The while loop continues until epoch % 64 >= 2. But "until" is ambiguous. Let me re-read.

`A while(condition1) B` means: while condition1 is true, do B. So while epoch % 64 < 2, do step. Exit when epoch % 64 >= 2.

So after the loop, epoch % 64 >= 2. I.e., epoch % 64 is 2, 3, ..., 63.

So the exit condition is epoch % 64 >= 2.

Hmm I had it backwards.

So if initial epoch = 0:
- 0 % 64 = 0 < 2. Step. epoch = 1.
- 1 % 64 = 1 < 2. Step. epoch = 2.
- 2 % 64 = 2 >= 2. Exit.

After loop, epoch = 2. So e0 = 2.

If initial epoch = 100:
- 100 % 64 = 36 >= 2. Exit immediately.

After loop, e0 = 100.

So e0 could be anything in [2, 63] (or 2 + 64*k, etc.).

Hmm. So my analysis depends on the initial epoch.

Wait but the test is parameterized to use whatever the initial epoch is. So the test should work for any e0 in [2, 63].

Let me trace for e0 = 100:
- Boost at 100. end = 163. Slot 35.
- Loop runs 62 distributes at 101, 102, ..., 162. epoch = 163 after.
- Slots checked: 38, 39, ..., 63, 0, 1, ..., 35. 62 slots total.
- Slot 35 checked at LAST distribute (162 -> 163). Boost moved to due.
- After loop, epoch = 163 = end. boosts_due = 1.
- expireDue expires Wv. boost_weight = 0. boosts_due = 0.
- exactDist(1n): distribute at 163. BoostsExpireFirst pass (boosts_due = 0). credit. advance to 164. Slot 36 checked.

After exactDist, epoch = 164 = end + 1.

Test asserts c.epoch === end (163). False!

So the test would fail for e0 = 100.

Hmm but the test was passing in v6 stage 3c. Let me check if maybe e0 is always in a specific range.

Actually wait, maybe the test expects different behavior. Let me re-read:

```typescript
await expireDue(); await exactDist(1n)
const c=await bc()
rec('BO.34b','...the Nth makes it DUE, at exactly its end epoch','true',String(c.epoch===end&&c.due>=1))
```

So after expireDue and exactDist(1n), check c.epoch === end.

If exactDist succeeds and advances epoch to end + 1, then c.epoch = end + 1. Not end.

Hmm so the test should fail.

Unless expireDue does something that makes exactDist fail (so epoch stays at end).

But expireDue doesn't change epoch.

Hmm.

Wait, maybe the test passes for specific e0 values. Let me check what e0 would be for the test to pass.

For the test to pass: c.epoch === end after exactDist(1n).

If exactDist succeeds: epoch advances to end + 1.

If exactDist fails (BoostsExpireFirst or anything else): epoch stays at end - 1 (from before exactDist).

Wait, after the loop, epoch = end. If exactDist fails, epoch stays at end. Then c.epoch === end. ✓

But also need c.due >= 1. After the loop, boosts_due = 1. exactDist fails (BoostsExpireFirst). boosts_due stays at 1. ✓

So the test passes IF exactDist fails.

Hmm so for the test to pass, exactDist must fail.

For exactDist to fail, boosts_due must be > 0. So the loop must have moved the boost to due.

When does the loop move the boost to due? At the last distribute (the one that advances to end).

So the boost is moved to due at the last distribute of the loop.

After the loop, epoch = end, boosts_due = 1.

Then exactDist fails (boosts_due = 1). epoch stays at end.

c.epoch === end ✓. c.due >= 1 ✓.

Test passes!

OK so the test passes because exactDist is REFUSED (boosts_due = 1).

But then the boost did NOT apply to the Nth distribute! Because the Nth distribute was refused!

Wait but the loop runs 62 distributes. So the boost applied for 62 distributes. The 63rd (the one at end) is refused.

For N = 63: the boost applied for 62 distributes, not 63.

So the test actually verifies that the boost applies for N-1 distributes!

Hmm but the test comment says "the Nth makes it DUE". So the Nth is the one that makes it due. The Nth is... hmm, the 63rd distribute.

Wait if the boost is moved to due at the 63rd distribute's advance_epoch, then the 63rd distribute DID happen (the credit was done with boost). Then advance_epoch moves to due.

But the BoostsExpireFirst is checked at the START of distribute. So when the 63rd distribute is called, BoostsExpireFirst checks boosts_due = 0 (boost not yet due). Passes. Credit uses boost. Advance_epoch moves boost to due.

So the 63rd distribute DOES use the boost. After advance, boost is in due.

So the 63rd distribute is NOT refused (because BoostsExpireFirst was 0 at the start). The advance_epoch just moves the boost to due.

So the 63rd distribute succeeds, and the 64th (if attempted) would be refused.

So the boost applied for 63 distributes. ✓

Now after the loop (62 distributes), epoch = end - 1.

Wait, let me re-check. Loop iterates 62 times. Each step is 1 distribute. 62 distributes.

Initial epoch = 2. After 62 distributes, epoch = 2 + 62 = 64. end = 65.

So epoch = end - 1 = 64. 

Test asserts c.epoch === end - 1n. 64 === 64. ✓

Hmm but wait, the loop runs 62 distributes. So epoch advances from 2 to 2 + 62 = 64. ✓

The boost's slot is at 65 % 64 = 1. The slot is checked when advance_epoch results in dist_epoch such that dist_epoch % 64 = 1. I.e., dist_epoch % 64 = 1, so dist_epoch = 1, 65, 129, ...

In the loop, distributes happen at 3, 4, ..., 64. Advances: 4, 5, ..., 65. Slots: 4, 5, ..., 65 % 64 = 1.

So slot 1 is checked at advance_epoch from 64 to 65. The LAST distribute in the loop.

So after the loop (dist_epoch = 65 = end), boosts_due = 1.

Hmm but the test asserts c.epoch === end - 1n = 64. But epoch after loop is 65 (after 62 distributes from 2). 65 ≠ 64.

Hmm wait. Let me recount.

62 distributes. Each distribute advances epoch by 1.

Initial epoch = 2.

Distribute at epoch = 2: advance to 3. (1st distribute)
Distribute at epoch = 3: advance to 4. (2nd)
...
Distribute at epoch = X: advance to X+1. (X-1 th distribute)

After 62 distributes, the 62nd distribute was at epoch = 2 + 62 - 1 = 63. After advance, epoch = 64.

So after 62 distributes, epoch = 64. ✓

Hmm wait, let me recount. Distribute at 2 (1st), 3 (2nd), ..., 63 (62nd). After: epoch = 64. ✓

OK so after 62 distributes, epoch = 64 = end - 1 = 65 - 1. ✓

Now slot check. After the 62nd distribute (at 63, advance to 64), slot 64 % 64 = 0 checked.

Hmm so slot 0 is checked, not slot 1. Boost NOT moved to due.

So after 62 distributes, epoch = 64, boosts_due = 0.

Then `await recB(Wv)`. boost_weight is still 2 (no expire). ✓

Test asserts before.w === 2 ✓. (await bc()).epoch === end - 1n. 64 === 64 ✓.

Then `await expireDue()`. Looks for due vaults. Wv's end = 65. current epoch = 64. 65 > 64, so NOT due. expireDue does nothing.

Then `await exactDist(1n)`. distribute at 64. BoostsExpireFirst: pass (boosts_due = 0). credit uses boost. advance to 65. Slot 65 % 64 = 1 checked. THIS IS BOOST SLOT. Moved to due.

So after exactDist, epoch = 65 = end. boosts_due = 1.

Test asserts c.epoch === end. 65 === 65 ✓. c.due >= 1. 1 >= 1 ✓.

Great so the test passes!

Hmm so the boost applied for 63 distributes (at 3, 4, ..., 65). All 63 distributes used the boost.

After all 63, boosts_due = 1.

So the boost DID apply for N (= 63) distributes.

My earlier confusion was about when the slot was checked. Let me re-verify.

After advance_epoch from X to X+1, slot (X+1) % 64 is checked.

So distributes at 62, 63, 64, ..., 65 advance to 63, 64, 65, 66. Slots 63, 64, 65, 66 % 64 = 63, 0, 1, 2.

So slot 1 is checked at advance from 64 to 65. Which is the 63rd distribute (at 64, advance to 65).

So all 63 distributes (3 to 65 = 63 distributes) used the boost. ✓

OK so the off-by-one concern was unfounded. The boost DOES apply for N distributes.

Hmm so where did I go wrong?

Let me re-verify for the simple case: BE = 2.

Boost at e0. end = e0+2. Slot (e0+2) % 64.

Loop: 1 distribute (exactDist). So 1 distribute.

Wait the test for BO.21 has 1 exactDist after the in-tx. So 1 in-tx + 1 exactDist = 2 distributes.

In-tx distribute at e0 (1st). advance to e0+1. Slot (e0+1) % 64 checked.
ExactDist at e0+1 (2nd). advance to e0+2. Slot (e0+2) % 64 = boost slot. Moved to due.

After 2 distributes, epoch = e0+2 = end. boosts_due = 1.

So 2 distributes applied the boost. ✓

Now for BE = 5 without in-tx:
- Boost at e0. end = e0+5. Slot (e0+5) % 64.
- 5 distributes at e0+1, e0+2, e0+3, e0+4, e0+5.
- Each advance checks slot (X+1) % 64.
- Slot (e0+5) % 64 = boost slot. Checked at advance from e0+4 to e0+5 (the 5th distribute).
- After 5 distributes, epoch = e0+5 = end. boosts_due = 1.

So 5 distributes applied the boost. ✓

For BE = 63 without in-tx:
- Boost at e0. end = e0+63. Slot (e0+63) % 64.
- 63 distributes at e0+1, ..., e0+63.
- Slot checked at distribute at e0+62 (advance to e0+63). 63rd distribute.
- After 63 distributes, epoch = e0+63 = end. boosts_due = 1.

So 63 distributes applied the boost. ✓

OK so my earlier off-by-one concern was wrong.

So the boost schedule is:
- Boost bought at dist_epoch K with epochs N.
- Stored at slot (K + N) % 64.
- Boost applied for N distributes (at K+1, ..., K+N).
- After the Nth distribute, slot is checked, boost moved to due.
- (N+1)th distribute would be refused.

So the boost applies for EXACTLY N distributes. ✓

Great. My off-by-one concern was wrong.

Let me look at potential issues in the boost's other behavior.

Actually wait, I think there might be an issue with the boost and pending_count or boosts_active counts.

Let me re-read boost_vault:
```rust
pub fn boost_vault(ctx: Context<BoostVault>, max_price: u64, min_weight: u8, min_epochs: u16) -> Result<()> {
    ...
    let (price, extra, epochs, cbob, collection) = {
        let c = &ctx.accounts.config;
        (c.boost_price, c.boost_weight, c.boost_epochs, c.cbob_mint, c.collection)
    };
    require!(price > 0 && extra > 0 && epochs > 0, MintError::BoostsOff);
    require!(price <= max_price && extra >= min_weight && epochs >= min_epochs, MintError::BoostTermsMoved);
    {
        let r = &ctx.accounts.vault_record;
        require!(r.active && !r.retired && !r.pending, MintError::BoostNeedsActiveVault);
        require!(r.boost_weight == 0, MintError::BoostActive);
        require_keys_eq!(ctx.accounts.asset.key(), r.asset, MintError::WrongAsset);
    }
    ...
    // The asset's CURRENT owner (Core AssetV1: key, then owner), read at execution, so a vault sold a second ago is boosted by its new owner.
    let d = ctx.accounts.asset.try_borrow_data()?;
    let mut o = [0u8; 32]; o.copy_from_slice(&d[1..33]);
    require_keys_eq!(Pubkey::new_from_array(o), ctx.accounts.burner.key(), MintError::BoostNotTheOwner);
    ...
}
```

OK so boost_vault:
1. Check price/extra/epochs > 0.
2. Check buyer's terms (price <= max_price, extra >= min_weight, epochs >= min_epochs).
3. Check vault is active, not retired, not pending.
4. Check vault has no active boost.
5. Check asset matches record's asset.
6. Check burner is the current owner (read from asset data).

Hmm wait, step 6 reads the asset data. But the asset might be 64 bytes or different. Let me check.

For a Core asset, the data is AssetV1 (key=u8=1, owner=32 bytes, update_authority_disc=u8, collection=32 bytes, name=..., uri=..., attributes=...). The minimum is 1 + 32 + 1 + 32 = 66 bytes.

The boost_vault code does:
```rust
let d = ctx.assets.try_borrow_data()?;
let mut o = [0u8; 32]; o.copy_from_slice(&d[1..33]);
```

So reads 32 bytes from offset 1. That requires data.len() >= 33. For AssetV1, that's true.

But what if the asset is a foreign type (not AssetV1)? Like AssetV2 with different layout?

Hmm, but `require_live_vault` would have caught that. Let me look... actually boost_vault doesn't check the asset key. Let me re-look.

```rust
{
    let r = &ctx.accounts.vault_record;
    require!(r.active && !r.retired && !r.pending, MintError::BoostNeedsActiveVault);
    require!(r.boost_weight == 0, MintError::BoostActive);
    require_keys_eq!(ctx.accounts.asset.key(), r.asset, MintError::WrongAsset);
}
```

So boost_vault only checks the asset matches the record's asset. It doesn't check the asset is a Core AssetV1.

Then later:
```rust
let d = ctx.accounts.asset.try_borrow_data()?;
let mut o = [0u8; 32]; o.copy_from_slice(&d[1..33]);
require_keys_eq!(Pubkey::new_from_array(o), ctx.accounts.burner.key(), MintError::BoostNotTheOwner);
```

Reads d[1..33]. If d.len() < 33, the slice panics.

But the asset is a Core AssetV1 (minimum 66 bytes). So d.len() >= 33. OK.

But what if d.len() == 33? Then d[1..33] reads the owner. But this isn't necessarily an AssetV1 (which has key=1 first).

Hmm but the asset is in our collection (the record's collection is checked in reveal_level and mint_vault). But boost_vault doesn't re-check.

Hmm OK so if a foreign asset is somehow used, the owner check might be misleading.

Actually, the asset's key is supposed to be Core AssetV1. The check `require_live_vault` does:
```rust
fn require_live_vault(a: &AccountInfo, collection: &Pubkey) -> Result<()> {
    require_keys_eq!(*a.owner, MPL_CORE_ID, MintError::NotALiveVault);
    let d = a.try_borrow_data()?;
    require!(d.len() >= 66 && d[0] == KEY_ASSET_V1, MintError::NotALiveVault);
    require!(d[33] == UA_DISC_COLLECTION, MintError::NotALiveVault);
    let mut c = [0u8; 32]; c.copy_from_slice(&d[34..66]);
    require_keys_eq!(Pubkey::new_from_array(c), *collection, MintError::NotALiveVault);
    Ok(())
}
```

So require_live_vault checks owner is MPL_CORE_ID, key is 1, UA disc is collection (2), and collection matches.

But boost_vault doesn't call require_live_vault. It only reads d[1..33].

So if a foreign asset has the same record.asset as the vault record... hmm that's not possible because the record's asset is set when the vault was created. The asset address is the record's PDA.

Wait, the record.asset is set at mint time. The boost_vault's ctx.accounts.asset.key() is checked to equal r.asset. So the asset account must be the record's asset.

The asset account's owner (Core program) is fixed by Core. If the asset is owned by something other than Core, it wouldn't be a valid vault. But require_live_vault is the one that checks this, and it's not called here.

Hmm so a bypass: if the asset's owner is NOT Core (e.g., System program or some other program), boost_vault might still work (the d[1..33] slice is just some 32 bytes).

But would such an asset exist? It would have to have the same address as a real Core asset, which is impossible (different owners would be different accounts).

Wait, an address IS an account. The address uniquely identifies the account. The owner of the account determines what program manages it. Different owners = different programs.

So if r.asset is a valid Core AssetV1 (asset.owner == Core), then ctx.accounts.asset is the same account, and ctx.accounts.asset.owner == Core.

But boost_vault doesn't check this. Could there be a mismatch somehow?

Hmm, no. The address uniquely identifies the account. r.asset and ctx.accounts.asset.key() are the same. So they have the same owner.

So boost_vault's owner check is consistent with the record.

OK so no issue there.

Let me check the cbob_mint and burner's $CBOB account more carefully.

```rust
require_keys_eq!(ctx.accounts.cbob_mint.key(), cbob, MintError::WrongCbobMint);
require_keys_eq!(*ctx.accounts.cbob_mint.owner, SPL_TOKEN_ID, MintError::WrongCbobMint);
let burner = ctx.accounts.burner.key();
let (bal, state) = read_token(&ctx.accounts.burner_token, &cbob, &burner)?;
require!(state == TOKEN_STATE_INITIALIZED && bal >= price, MintError::InsufficientCbob);
```

So checks:
- cbob_mint.key() == config's cbob_mint.
- cbob_mint.owner == SPL_TOKEN_ID (classic SPL).
- read_token returns (balance, state) for burner's $CBOB account.
- state == INITIALIZED (not frozen).
- balance >= price.

Then burns price:
```rust
let mut data = vec![IX_SPL_BURN];
data.extend_from_slice(&price.to_le_bytes());
invoke(&Instruction {
    program_id: SPL_TOKEN_ID,
    accounts: vec![
        AccountMeta::new(ctx.accounts.burner_token.key(), false),
        AccountMeta::new(cbob, false),
        AccountMeta::new_readonly(burner, true),
    ],
    data,
}, &[ctx.accounts.burner_token.to_account_info(), ctx.accounts.cbob_mint.to_account_info(),
     ctx.accounts.burner.to_account_info(), ctx.accounts.token_program.to_account_info()])?;
```

So calls SPL Token's Burn instruction. Burns `price` of $CBOB from burner_token.

Then updates the config:
```rust
let c = &mut ctx.accounts.config;
let r = &mut ctx.accounts.vault_record;
let end = c.dist_epoch.checked_add(epochs as u64).ok_or(MintError::Overflow)?;
let i = (end % BOOST_RING as u64) as usize;
c.boost_expiring[i] = c.boost_expiring[i].checked_add(1).ok_or(MintError::Overflow)?;
c.boosts_active = c.boosts_active.checked_add(1).ok_or(MintError::Overflow)?;
c.boost_weight_total = c.boost_weight_total.checked_add(extra as u64).ok_or(MintError::Overflow)?;
c.cbob_burned_total = c.cbob_burned_total.checked_add(price).ok_or(MintError::Overflow)?;
reweigh(c, r, extra)?;
r.boost_end_epoch = end;
```

Hmm OK boost is correctly tracked.

OK let me move on and try to find more.

Let me look at the BURN program now. burn_vault:

```rust
pub fn burn_vault(ctx: Context<BurnVault>, declared: u8) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let collection_cfg = cfg.collection;
    require_keys_eq!(*ctx.accounts.vault_asset.owner, MPL_CORE_ID, BurnError::NotACoreAsset);

    let (asset_owner, collection) = {
        let d = ctx.accounts.vault_asset.try_borrow_data()?;
        require!(d.len() >= 66 && d[0] == KEY_ASSET_V1, BurnError::NotACoreAsset);
        require!(d[33] == UA_DISC_COLLECTION, BurnError::ForeignVault);
        let mut o = [0u8; 32]; o.copy_from_slice(&d[1..33]);
        let mut c = [0u8; 32]; c.copy_from_slice(&d[34..66]);
        (Pubkey::new_from_array(o), Pubkey::new_from_array(c))
    };
    require_keys_eq!(asset_owner, ctx.accounts.owner.key(), BurnError::NotTheOwner);
    require_keys_eq!(collection, collection_cfg, BurnError::ForeignVault);
    require_keys_eq!(ctx.accounts.collection.key(), collection, BurnError::WrongCollectionAccount);

    // ---- the invariant, the other half: a matching THAW came first ----
    {
        let sysvar = ctx.accounts.instructions.to_account_info();
        let current = load_current_index_checked(&sysvar)? as usize;
        let asset = ctx.accounts.vault_asset.key();
        let owner = ctx.accounts.owner.key();
        let mut found = false;
        for i in 0..current {
            if let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
                if ix.program_id == SEAL_PROGRAM_ID
                    && ix.data.len() >= IX_OPEN_FOR_REDEMPTION_DISC.len()
                    && ix.data[..IX_OPEN_FOR_REDEMPTION_DISC.len()] == IX_OPEN_FOR_REDEMPTION_DISC
                    && ix.accounts.get(SEAL_IX_ASSET_IDX).map(|a| a.pubkey) == Some(asset)
                    && ix.accounts.get(SEAL_IX_OWNER_IDX).map(|a| a.pubkey) == Some(owner)
                { found = true; break; }
            }
        }
        require!(found, BurnError::NoPrecedingOpen);
    }
```

So burn_vault:
1. Asset owner is Core.
2. Asset is AssetV1, in our collection, owned by signer.
3. Collection account matches asset's collection.
4. Walk instructions sysvar to find preceding open for same asset + owner.

Note that BURN loops through all instructions 0 to current-1. So it walks back through ALL prior top-level instructions. This is to handle multiple redemptions in one tx.

But hmm, if there are multiple burns in one tx, the loop finds the first one matching. But each burn needs to find ITS OWN preceding open.

Let me trace. Two burns in one tx: [open A, sweep A, burn A, open B, sweep B, burn B].

For burn B (the 6th instruction, current = 6):
- Loop through 0 to 5.
- Find open for B.

The loop finds open B at index 3 (the 4th instruction).

OK so burn B finds its own open.

For burn A (the 3rd instruction, current = 3):
- Loop through 0 to 2.
- Find open for A.

The loop finds open A at index 0.

OK so each burn finds its own open. Good.

But what if there are duplicate burns? E.g., [open A, burn A, burn A].

For burn A (2nd burn, current = 3):
- Loop finds open A.

OK passes.

For burn A (3rd burn, current = 4):
- Loop finds open A.

OK passes.

But there are TWO burn A's. Both pass. So two burns.

But burn A burns the asset. After the first burn, the asset is burned (Core's tombstone). The second burn would call Core's BurnV1 with the asset. Core would refuse (already burned).

Hmm so the second burn fails at the Core level.

But this means a single burn_vault tx could potentially do two burn_vaults on the same asset. The first succeeds, the second fails at Core.

But the second burn still passed the open check. So the tx is not rejected by BURN.

OK so the open check is satisfied for both. The second fails at Core.

Hmm but what about the empties proof? Both pass it (same conditions, same emptiness).

Then the second calls Core's BurnV1, which fails because asset is already burned.

Hmm. The second burn would then fail, reverting the entire tx.

OK so this is just a Core-level failure. Not a real issue.

Hmm but there's still something to check. What if the order is [burn A, open A, burn A]? The second burn should fail (no preceding open).

For the second burn A (current = 3):
- Loop through 0 to 2.
- 0 is burn A. Not an open. Skip.
- 1 is open A. Match!
- Found = true. Passes.

So the second burn A passes the open check.

But the order is [burn A, open A, burn A]. The first burn A has no preceding open. It should fail at its open check.

For burn A (1st burn, current = 1):
- Loop through 0 to 0.
- 0 is itself? No, current = 1 means ix 0 is the first burn.

Hmm wait, the loop is `for i in 0..current`. So for current = 1, loop i = 0 to 0. Hmm but i = 0 is the burn itself.

So burn A (current = 1) checks instruction 0 (itself). ix.data is burn_vault data. Not open_for_redemption data. Skip.

Loop ends. found = false. Refused: NoPrecedingOpen.

Good. So the first burn A is refused.

Then the tx fails. So the [burn A, open A, burn A] order is rejected.

OK so the open check works.

But what about [open A, burn A, burn A]? Both burn A's find open A.

First burn A (current = 2). Loop i = 0 to 1. ix 0 is open A. Match.
Second burn A (current = 3). Loop i = 0 to 2. ix 0 is open A. Match.

Both pass. Both call Core's BurnV1. First succeeds. Second fails (asset already burned).

Tx fails at second burn. So only one burn is performed.

OK.

Now let me look at another potential issue: the BURN config reading.

BURN reads from SEAL config and MINT config. Let me verify the offsets.

```rust
const OFF_RESERVES: usize = 41;
```

This is in BURN source. Reading SEAL config's reserves at offset 41.

Looking at SEAL config:
```rust
pub struct Config {
    pub version: u8,
    pub collection: Pubkey,
    pub reserve_mints: Vec<Pubkey>,
    pub bump: u8,
}
```

At offset 8 (disc), 9 (version), 40 (collection, 32 bytes from 9 to 41). At offset 41: reserve_mints (Vec<Pubkey>).

Vec is u32 length + items. So d[41..45] is the length (LE), then 32-byte keys.

So BURN reads d[41..45] as length, then 32-byte keys. ✓

Now BURN reads MINT config:
```rust
const OFF_MINT_MINTED_TOTAL: usize = 141;
const OFF_MINT_BARE_RETIRED: usize = 454;
```

These match the MINT config layout I computed. ✓

OK offsets are correct.

Now let me look at the MINT's BurnVault accounts:
```rust
pub struct BurnVault<'info> {
    /// CHECK: validated as a Core AssetV1 in our collection, owned by `owner`.
    /// MUST stay account 0 — SEAL's `open_for_redemption` matches on it to prove
    /// this transaction's thaw and this burn are for the same vault.
    #[account(mut)]
    pub vault_asset: UncheckedAccount<'info>,
    /// CHECK: must equal the asset's collection; verified against config.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// MUST stay account 2 — SEAL's `open_for_redemption` matches on it.
    pub owner: Signer<'info>,
    /// CHECK: Core's asset-signer PDA — the vault itself.
    #[account(mut, seeds = [EXECUTE_PREFIX, vault_asset.key().as_ref()], bump, seeds::program = MPL_CORE_ID)]
    pub asset_signer: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, BurnConfig>,
    /// CHECK: the SEAL program's config — canonical wiring, verified in-handler.
    pub seal_config: UncheckedAccount<'info>,
    /// CHECK: instructions sysvar — the burn verifies a preceding thaw.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the MINT program (v6 stage 3), pinned.
    #[account(address = MINT_PROGRAM_ID)]
    pub mint_program: UncheckedAccount<'info>,
    /// CHECK: MINT's config; MINT checks it by seeds.
    #[account(mut)]
    pub mint_config: UncheckedAccount<'info>,
    /// CHECK: MINT's record for this vault; MINT checks it by seeds and asset.
    #[account(mut)]
    pub vault_record: UncheckedAccount<'info>,
    /// CHECK: MINT's pool (its config's cbBTC account), passed to `retire_redeemed`
    /// for the monthly in-line distribution; MINT checks it is the real pool.
    pub pool_token: UncheckedAccount<'info>,
}
```

So BurnVault has accounts:
- 0: vault_asset (must be account 0 for SEAL's open check)
- 1: collection
- 2: owner (must be account 2 for SEAL's open check)
- 3: asset_signer (PDA)
- 4: payer
- 5: config
- 6: seal_config
- 7: instructions
- 8: mpl_core
- 9: system_program
- 10: mint_program
- 11: mint_config
- 12: vault_record
- 13: pool_token

Then remaining accounts for declared tokens. Each pair (source, destination for each token program).

The instruction data:
- 8 bytes discriminator
- 1 byte declared count

So burn_vault takes the declared count from data and checks remaining accounts count.

```rust
require!(ctx.accounts.asset_signer.lamports() == 0, BurnError::VaultNotEmpty);
require!(ctx.remaining_accounts.len() == declared as usize, BurnError::DeclarationMismatch);
```

So requires PDA lamports == 0 (vault wallet is empty) AND declared count matches remaining accounts.

Then loops through reserves, checks each reserve mint's ATA under both token programs.

Hmm wait, the loop:
```rust
for mint in reserves.iter() {
    for token_program in [SPL_TOKEN_ID, SPL_TOKEN_2022_ID] {
        let (expected, _) = Pubkey::find_program_address(
            &[pda.as_ref(), token_program.as_ref(), mint.as_ref()], &ATA_PROGRAM_ID);
        let acc = ctx.remaining_accounts.iter().find(|a| a.key() == expected)
            .ok_or(BurnError::ReserveNotDeclared)?;
        if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
        let d = acc.try_borrow_data()?;
        if d.len() < TOKEN_ACCOUNT_LEN { continue; }
        let mut o = [0u8; 32]; o.copy_from_slice(&d[32..64]);
        require_keys_eq!(Pubkey::new_from_array(o), pda, BurnError::ReserveNotOurs);
        require!(d[72..76] == [0,0,0,0], BurnError::ReserveDelegated);
        require!(d[121..129] == [0u8; 8], BurnError::ReserveDelegated);
        require!(d[129..133] == [0,0,0,0], BurnError::ReserveDelegated);
        require!(d.len() == TOKEN_ACCOUNT_LEN, BurnError::ReserveHasExtensions);
        let mut amt = [0u8; 8]; amt.copy_from_slice(&d[64..72]);
        require!(u64::from_le_bytes(amt) == 0, BurnError::VaultNotEmpty);
    }
}
```

So for each reserve mint, checks both token-program derivations. If the ATA exists and is a valid token account, checks the various conditions.

If the ATA doesn't exist (no matching account), reservedNotDeclared is REFUSED.

But wait, the loop only refuses if NO matching account exists. So if one of the two derivations is missing, the other might still pass.

Let me re-think. For each (reserve mint, token program) pair, the expected ATA is derived. The loop looks for an account in remaining_accounts with that key.

If the account is not in remaining_accounts: `?` operator returns ReserveNotDeclared. So if any (mint, token_program) pair's ATA is missing, error.

But the OUTER loop iterates over reserves. The INNER loop iterates over token programs. So:
- For each reserve mint (3 mints), iterate over 2 token programs = 6 iterations.

For each iteration, find the account by key. If missing, error.

So all 6 expected ATAs must be in remaining_accounts.

Hmm but the reserve list could have 1 to 3 mints. For 1 mint, 2 derivations. For 3 mints, 6 derivations.

The loop visits all of them. All must be present.

OK that's correct.

But wait, what about Token-2022 ATAs that may or may not exist? Both derivations are checked. So the caller must pass BOTH the classic SPL ATA and the Token-2022 ATA (even if only one of them exists on chain).

The page tests would need to create both. But the test fixture in `sim/test-vault.ts` does `declare(pda)` which returns both. So both are passed.

In production, both ATAs would also be created in a prior transaction (per item 50 of the redeem page requirements).

Hmm OK.

Now let me look at the second loop:
```rust
for acc in ctx.remaining_accounts.iter() {
    if acc.owner == &MPL_CORE_ID {
        let d = acc.try_borrow_data()?;
        require!(d.is_empty() || d[0] != KEY_ASSET_V1, BurnError::VaultStillHoldsAVault);
        continue;
    }
    if acc.lamports() == 0 { continue; }
    if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
    let d = acc.try_borrow_data()?;
    if d.len() >= TOKEN_ACCOUNT_LEN {
        let mut o = [0u8; 32]; o.copy_from_slice(&d[32..64]);
        if Pubkey::new_from_array(o) == pda {
            require!(d.len() == TOKEN_ACCOUNT_LEN, BurnError::ReserveHasExtensions);
            require!(d[72..76] == [0,0,0,0], BurnError::ReserveDelegated);
            require!(d[121..129] == [0u8; 8], BurnError::ReserveDelegated);
            require!(d[129..133] == [0,0,0,0], BurnError::ReserveDelegated);
            let mut amt = [0u8; 8]; amt.copy_from_slice(&d[64..72]);
            require!(u64::from_le_bytes(amt) == 0, BurnError::VaultNotEmpty);
        }
    }
}
```

This loop iterates through all remaining accounts and checks each one for being:
1. A Core asset (nested vault). If so, must NOT be a live AssetV1.
2. An SPL Token account with the vault's PDA as owner. If so, must satisfy various checks.
3. Anything else: skipped (if 0 lamports, or if not SPL Token).

Hmm interesting. So this loop also catches non-ATA token accounts owned by the vault PDA. So if someone has a non-ATA token account, this loop catches it.

But what about the count? The outer loop already counted the reserves (the 3 * 2 = 6 derivations). But this inner loop iterates ALL remaining accounts, including non-reserve ATAs.

So if there are EXTRA accounts, this loop processes them.

For example, if someone passes 6 reserve ATAs + 1 extra (a stray token account owned by the vault PDA), this loop catches it.

Hmm OK that's good.

But wait, there's a potential issue. The first loop (over reserves) refuses if a reserve ATA is missing. But the second loop (over all remaining) requires it to be a valid token account or it skips.

So if someone passes 6 reserve ATAs (all valid, all empty), plus 1 extra (a valid SPL token account owned by PDA but with extensions), this loop:
- For the extra account: not reserve (already checked). owner is SPL Token. d.len() >= TOKEN_ACCOUNT_LEN. owner == pda. requires `d.len() == TOKEN_ACCOUNT_LEN` - but d has extensions, so d.len() > TOKEN_ACCOUNT_LEN. Require fails with ReserveHasExtensions.

Hmm so the burn would fail because of extensions.

But what if the extra account is owned by PDA, has 0 amount, no extensions, no delegates? Then it's fine.

What if the extra account has 0 amount, no extensions, no delegates, BUT it's a non-ATA (d.len() = 165, owner = pda, mint = reserve_mint)? Then it's a valid token account. The check `d.len() == TOKEN_ACCOUNT_LEN` passes. Delegate checks pass. Amount = 0. All good.

So this allows non-ATA token accounts held by the PDA. As long as they are properly declared.

Hmm interesting. So the burn can pass even if there are non-ATA token accounts.

But wait, what if there's a non-ATA token account held by the PDA that has amount > 0? Then VaultNotEmpty.

What if there's a non-ATA token account held by PDA that has extensions (d.len() > 165)? Then ReserveHasExtensions. Hmm but this is named for reserves, but the check applies here.

OK these checks seem consistent.

Now let me look at another potential issue: what about a foreign Core asset (not in our collection)? The second loop checks `acc.owner == &MPL_CORE_ID` then `d.is_empty() || d[0] != KEY_ASSET_V1`.

If d.is_empty(): OK (continue). Hmm, an empty Core asset? Not sure if that's possible.

If d[0] != KEY_ASSET_V1: OK. This means not an AssetV1 (could be CollectionV1 or something else).

Hmm so the only thing checked for Core assets is that they're not AssetV1. So a Core asset owned by PDA is OK if it's not AssetV1. But a Core asset (any type) held by the PDA doesn't violate the burn rules.

Hmm but a foreign Core AssetV1 (not in our collection) is REFUSED (VaultStillHoldsAVault).

But the test fixture has:
```typescript
rec('9.5','burn the outer vault with the nested one UNDECLARED','ALLOW',out2.ok?'ALLOW':'REJECT',
  `THE GAP: on-chain enumeration of nested Core assets does not exist, so the redeem client must scan BEFORE the owner signs. ${out2.err}`)
```

So the test expects this to ALLOW (the burn succeeds even with nested asset). The nested asset is DESTROYED (since it's nested in a burned vault, the nested is now in a stale state).

OK so this is the documented behavior. A nested asset is DESTROYED when the outer is burned (since nothing can sign for the PDA to access the nested).

Hmm so the burn code allows this. Good.

Now let me look at the `is_burned` function:
```rust
fn is_burned(a: &AccountInfo) -> Result<bool> {
    let d = a.try_borrow_data()?;
    Ok(*a.owner == MPL_CORE_ID && d.len() == 1 && d[0] == 0)
}
```

So a burned asset: owned by Core, exactly 1 byte, byte 0 is 0.

This is the Core tombstone for a burned asset.

OK.

Now let me look at the BURN calls Core::BurnV1:
```rust
let ix = Instruction {
    program_id: MPL_CORE_ID,
    accounts: vec![
        AccountMeta::new(ctx.accounts.vault_asset.key(), false),
        AccountMeta::new(ctx.accounts.collection.key(), false),
        AccountMeta::new(ctx.accounts.payer.key(), true),
        AccountMeta::new_readonly(ctx.accounts.owner.key(), true),
        AccountMeta::new_readonly(MPL_CORE_ID, false),
        AccountMeta::new_readonly(MPL_CORE_ID, false),
    ],
    data: vec![IX_BURN_V1, 0],
};
invoke(&ix, &[...])?;
```

So calls Core's BurnV1 with the asset (mut), collection (mut), payer (signer), owner (readonly signer), and 2 MPL_CORE accounts (readonly).

OK standard Core burn.

Now let me think about a potential issue: the asset must be burned by Core. But Core's BurnV1 has its own checks. Let me think.

Actually, Core's BurnV1 checks:
- Asset owner (signer).
- Asset is not already burned.

So Core would check `ctx.accounts.owner.key()` is the asset's owner.

The asset's owner is the address that signed this tx (or someone who can sign for it).

OK so the owner must be the current owner of the asset. If alice sells the asset to bob, then bob can burn it.

But what about the redeem flow? Alice redeems (alice signs). SEAL opens for vault with asset=S, owner=alice. Then BURN checks asset's owner == alice. If alice still owns S, passes.

What if alice transferred S to bob after the open but before the burn? Then BURN checks asset's owner == alice. But bob is the new owner. Fails.

Hmm but the open check was done with alice as owner. The burn check is done with bob as owner.

But SEAL's open is only valid for the same owner as the burn. Let me check SEAL's open:

```rust
let asset = ctx.accounts.vault_asset.key();
let owner = ctx.accounts.owner.key();
...
for i in current.checked_add(1..) {
    if let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
        if ix.program_id == BURN_PROGRAM_ID
            && ix.data.len() >= IX_BURN_VAULT_DISC.len()
            && ix.data[..IX_BURN_VAULT_DISC.len()] == IX_BURN_VAULT_DISC
            && ix.accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(asset)
            && ix.accounts.get(BURN_IX_OWNER_IDX).map(|a| a.pubkey) == Some(owner)
        { found = true; break; }
    }
}
require!(found, VaultError::NoTerminalBurn);
```

So SEAL's open looks for BURN's burn_vault for same asset AND owner. Owner is the signer's pubkey (ctx.accounts.owner.key()).

BURN's burn_vault looks for SEAL's open for same asset AND owner. Owner is also the signer's pubkey.

So both programs check owner == signer. They must match.

But what if the asset's owner changes between open and burn? Then the signer's pubkey is still the same (the original signer), but the asset's owner is different.

SEAL's open doesn't check asset's owner (read for thaw). It only checks that a burn_vault exists in the same tx for same asset + signer.

BURN's burn_vault checks asset's owner == signer (asset's current owner matches signer's pubkey).

Hmm but wait, BURN's check is `require_keys_eq!(asset_owner, ctx.accounts.owner.key(), BurnError::NotTheOwner)`. Where `asset_owner` is read from asset's data.

So BURN reads asset's current owner and compares to signer. If they differ, burn fails.

SEAL doesn't check this. SEAL only checks signer and that a burn_vault for same signer exists later.

So if alice signs open, then transfers the asset to bob, then bob signs burn, BURN would fail because asset's owner is bob, not alice.

OK so the flow works.

But wait, there's a subtle issue. What if alice signs both open and burn? Then asset's owner must still be alice at burn time.

If alice opens, then transfers to bob, then bob signs burn with himself as signer... hmm but SEAL's open was for alice. SEAL doesn't know about the transfer.

BURN's burn is for bob (signer). But BURN looks for preceding open for SIGNER bob. There is none (open was for alice). So BURN fails (NoPrecedingOpen).

OK so this scenario fails correctly.

What if alice signs open, then transfers to bob, then bob transfers back to alice, then alice signs burn? Then SEAL's open (for alice), BURN's burn (for alice). BURN looks for preceding open for alice. Finds it. Passes.

But the asset's owner changed twice (alice -> bob -> alice). The seal was thawed (by alice). The burn is signed by alice. OK.

So this works. The owner-change-and-change-back scenario works.

But wait, what if alice signs open, then transfers to bob (who doesn't transfer back), then alice signs burn (alice is no longer owner)? 

BURN's burn checks asset_owner == alice. Asset owner is bob. Fails.

So this fails correctly.

OK.

Now let me look at another potential issue: the charter claim window and supply.

```rust
require!(now >= cfg.charter_opens_at, MintError::CharterNotOpen);
require!(now < cfg.charter_closes_at, MintError::CharterClosed);
check_supply(cfg)?;
```

check_supply:
```rust
fn check_supply(cfg: &MintConfig) -> Result<()> {
    require!(cfg.minted_total < cfg.max_supply, MintError::SupplyCapReached);
    let cap_total: u64 = cfg.level_caps.iter().map(|c| *c as u64).sum();
    require!(cfg.minted_total < cap_total, MintError::LevelCapReached);
    Ok(())
}
```

So charter claims respect both max_supply and level_caps.

OK.

Now let me look at the SEAL program:

```rust
pub fn open_for_redemption(ctx: Context<OpenForRedemption>) -> Result<()> {
    let asset = ctx.accounts.vault_asset.key();
    let owner = ctx.accounts.owner.key();
    let (asset_owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
    require_keys_eq!(asset_owner, owner, VaultError::NotTheOwner);
    require_keys_eq!(collection, ctx.accounts.config.collection, VaultError::ForeignVault);
    require_keys_eq!(ctx.accounts.collection.key(), collection, VaultError::WrongCollectionAccount);

    let sysvar = ctx.accounts.instructions.to_account_info();
    let current = load_current_index_checked(&sysvar)? as usize;
    let mut found = false;
    let mut i = current.checked_add(1).ok_or(VaultError::Overflow)?;
    while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
        if ix.program_id == BURN_PROGRAM_ID
            && ix.data.len() >= IX_BURN_VAULT_DISC.len()
            && ix.data[..IX_BURN_VAULT_DISC.len()] == IX_BURN_VAULT_DISC
            && ix.accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(asset)
            && ix.accounts.get(BURN_IX_OWNER_IDX).map(|a| a.pubkey) == Some(owner)
        {
            found = true;
            break;
        }
        i += 1;
    }
    require!(found, VaultError::NoTerminalBurn);

    set_frozen(false, ...)?;
    emit!(RedemptionOpened { asset, owner });
    Ok(())
}
```

So SEAL iterates from current+1 onwards (instructions AFTER the current one). It looks for BURN's burn_vault for same asset + owner.

Note: SEAL iterates from `current + 1` onwards. It does NOT iterate backwards.

This is correct: the burn must come AFTER the open.

But BURN iterates from 0 to current - 1 (instructions BEFORE the burn). BURN looks for an open before it.

So both directions are correct.

But what about the case where multiple redemptions happen in one tx? Like [open A, sweep A, burn A, open B, sweep B, burn B].

For open A (1st instruction, current = 0):
- Iterate from 1 onwards.
- 1 = sweep A. Not burn. Skip.
- 2 = burn A. Match!
- Found.

For burn A (3rd instruction, current = 2):
- Iterate from 0 to 2.
- 0 = open A. Match!
- Found.

Good.

For burn B (6th instruction, current = 5):
- Iterate from 0 to 5.
- 0 = open A. asset=A, owner=alice. Not match (BURN for B has asset=B).
- 1 = sweep A. Not burn. Skip.
- 2 = burn A. Not match.
- 3 = open B. asset=B, owner=alice. Match!
- Found.

Good.

Now let me think about another potential issue: what if multiple burns for the same asset and owner?

Like [open A, burn A, burn A]. Two burn A's.

First burn A (2nd instruction, current = 1):
- Iterate from 0 to 0.
- 0 = open A. Match!
- Found.

Second burn A (3rd instruction, current = 2):
- Iterate from 0 to 1.
- 0 = open A. Match!
- 1 = burn A. Not an open. Skip.
- Found (at 0).

So both pass.

Both call Core's BurnV1. First succeeds. Second fails (already burned).

Hmm but both passed the open check. So the second burn's emptiness might be the same.

Hmm but the second burn would fail at Core. The whole tx reverts.

So the second burn doesn't actually happen. But it did the empty check first.

Wait actually let me re-check. The burn_vault does:
1. Check open exists.
2. Check empty (PDA lamports == 0).
3. Loop reserves (empty).
4. Loop all remaining accounts (empty).
5. Call Core's BurnV1.
6. Call MINT's retire_redeemed.

If Core's BurnV1 fails, the tx reverts. Steps 1-5 are done, but step 6 is not.

Hmm so the second burn passed steps 1-4 (empty checks). But Core's BurnV1 failed (asset already burned). Tx reverts.

OK so this is just a Core issue. Not really a BURN issue.

But the test 4.10 asserts "open vault A, burn vault B, nothing else" -> REJECT. So this should fail.

Let me check: for burn B (cross, no preceding open for B):
- Iterate from 0 to current.
- 0 = open A. asset=A, owner=alice. Not match (BURN for B has asset=B).
- Found = false. require!(found) fails.

OK so 4.10 works.

Now what about the test 3.9 (open vault A, pair with burn B):
- 3.9 is "open the FULL vault, pair it with a burn naming a DIFFERENT asset". The asset that was opened is A. The burn calls for B. BURN looks for open for B. Finds nothing. Fails.

Yes 3.9 fails correctly.

Now 3.10 is "open names alice, burn names a different owner". Similar.

OK these all work.

Now let me look at another potential issue. What if the open and burn reference the same asset but different collection?

The asset has a collection (Core AssetV1 update_authority_disc). The collection in SEAL is checked against config.collection. The collection in BURN is checked against config.collection.

Both programs reference the SAME config.collection (they're separate programs but read from the same SEAL config).

So both would agree on the collection.

But wait, BURN reads SEAL's config too:
```rust
let reserves: Vec<Pubkey> = {
    let (expected_cfg, _) = Pubkey::find_program_address(&[SEAL_CONFIG_SEED], &SEAL_PROGRAM_ID);
    require_keys_eq!(ctx.accounts.seal_config.key(), expected_cfg, BurnError::BadSealConfig);
    require_keys_eq!(*ctx.accounts.seal_config.owner, SEAL_PROGRAM_ID, BurnError::BadSealConfig);
    let d = ctx.accounts.seal_config.try_borrow_data()?;
    require!(d.len() >= OFF_RESERVES + 4, BurnError::BadSealConfig);
    require!(d[..8] == SEAL_CONFIG_DISC, BurnError::BadSealConfig);
    require!(d[OFF_VERSION] == SEAL_CONFIG_VERSION, BurnError::SealConfigVersion);
    let mut c = [0u8; 32]; c.copy_from_slice(&d[OFF_COLLECTION..OFF_COLLECTION + 32]);
    require_keys_eq!(Pubkey::new_from_array(c), collection_cfg, BurnError::WiringDiverged);
    ...
};
```

So BURN reads SEAL's config and checks collection matches its own config.

Good.

But wait, BURN reads the SEAL config TWICE. Once for the wiring check (init) and once for the reserves check (burn). This is redundant but correct.

OK now let me check the GOV program more.

```rust
fn read_mint_config(acc: &UncheckedAccount) -> Result<MintView> {
    let (expected, _) = Pubkey::find_program_address(&[b"mint-config"], &MINT_PROGRAM_ID);
    require_keys_eq!(acc.key(), expected, GovError::BadMintConfig);
    require_keys_eq!(*acc.owner, MINT_PROGRAM_ID, GovError::BadMintConfig);
    let d = acc.try_borrow_data()?;
    require!(d.len() >= OFF_MINT_MAX_BOOST_EPOCHS + 2, GovError::BadMintConfig);
    require!(d[..8] == MINT_CONFIG_DISC, GovError::BadMintConfig);
    require!(d[OFF_MINT_VERSION] == MINT_CONFIG_VERSION, GovError::BadMintConfig);
    let u = |o: usize| u64::from_le_bytes(d[o..o + 8].try_into().unwrap());
    let mut g = [0u8; 32]; g.copy_from_slice(&d[OFF_MINT_GOVERNANCE..OFF_MINT_GOVERNANCE + 32]);
    let mut col = [0u8; 32]; col.copy_from_slice(&d[OFF_MINT_COLLECTION..OFF_MINT_COLLECTION + 32]);
    Ok(MintView {
        collection: Pubkey::new_from_array(col),
        governance: Pubkey::new_from_array(g),
        minted_total: u(OFF_MINT_MINTED_TOTAL),
        bare_retired: u(OFF_MINT_BARE_RETIRED),
        charter_closes_at: u(OFF_MINT_CHARTER_CLOSES) as i64,
        sol_reserve: u(OFF_MINT_SOL_RESERVE),
        max_sweep: u(OFF_MINT_MAX_SWEEP),
        cooldown: u(OFF_MINT_COOLDOWN) as i64,
        sweep_floor: u(OFF_MINT_SWEEP_FLOOR),
        cooldown_ceiling: u(OFF_MINT_COOLDOWN_CEILING) as i64,
        reserve_ceiling: u(OFF_MINT_RESERVE_CEILING),
        max_boost_weight: d[OFF_MINT_MAX_BOOST_WEIGHT],
        max_boost_epochs: u16::from_le_bytes(d[OFF_MINT_MAX_BOOST_EPOCHS..OFF_MINT_MAX_BOOST_EPOCHS + 2].try_into().unwrap()),
    })
}
```

So GOV reads MINT config at various offsets. Let me verify OFF_MINT_SOL_RESERVE = 257.

In MintConfig:
- sol_reserve_lamports at offset 257. ✓

OFF_MINT_MAX_SWEEP = 266:
- max_sweep_lamports at offset 266. ✓

OFF_MINT_COOLDOWN = 274:
- sweep_cooldown_secs at offset 274. ✓

OFF_MINT_SWEEP_FLOOR = 631:
- sweep_floor_lamports at offset 631. ✓

OFF_MINT_COOLDOWN_CEILING = 639:
- cooldown_ceiling_secs at offset 639. ✓

OFF_MINT_RESERVE_CEILING = 647:
- reserve_ceiling_lamports at offset 647. ✓

OFF_MINT_MAX_BOOST_WEIGHT = 711:
- max_boost_weight at offset 711. ✓

OFF_MINT_MAX_BOOST_EPOCHS = 712:
- max_boost_epochs at offset 712. ✓

OK all offsets check out.

Now let me look at another potential issue: the ordering marks in GOV.

```rust
let cfg = &mut ctx.accounts.config;
let mut calls: Vec<Vec<u8>> = Vec::new();
for a in p.actions.iter() {
    match a {
        ProposalAction::SetRound { opens_at, closes_at, price, cap } => {
            if id <= cfg.last_round_id { skipped(id, "set_round", "superseded"); continue; }
            cfg.last_round_id = id;
            if *closes_at <= now { skipped(id, "set_round", "round_already_over"); continue; }
            ...
        }
        ProposalAction::Brakes { restart_sales, restart_sweep, set_guardian, guardian } => {
            if *set_guardian {
                if id <= cfg.last_guardian_id { skipped(id, "arm_guardian", "superseded"); }
                else {
                    cfg.last_guardian_id = id;
                    let mut d = IX_ARM_GUARDIAN.to_vec();
                    d.extend_from_slice(&guardian.try_to_vec()?);
                    calls.push(d);
                }
            }
            ...
```

So the marks are updated only when the action is actually added to calls. If skipped, mark not updated.

But wait, for Brakes with set_guardian = Some, the mark IS updated (line `cfg.last_guardian_id = id`). Even if the action is overridden (skipped), the mark is moved.

Hmm wait no, let me re-read:

```rust
if *set_guardian {
    if id <= cfg.last_guardian_id { skipped(id, "arm_guardian", "superseded"); }
    else {
        cfg.last_guardian_id = id;
        let mut d = IX_ARM_GUARDIAN.to_vec();
        d.extend_from_slice(&guardian.try_to_vec()?);
        calls.push(d);
    }
}
```

So if id <= last_guardian_id: skip (don't update). Else: update and push.

Hmm but the `if id <= cfg.last_guardian_id` check uses `<=`, not `<`. So if id EQUALS last_guardian_id, it's skipped.

But the mark is updated BEFORE the check is done? No, the check is done first.

Hmm wait, for SetRound:
```rust
if id <= cfg.last_round_id { skipped(id, "set_round", "superseded"); continue; }
cfg.last_round_id = id;
if *closes_at <= now { skipped(id, "set_round", "round_already_over"); continue; }
```

So for SetRound: check superseded. If yes, skip. If no, UPDATE mark. Then check if round already over. If yes, skip (but mark is already updated!).

Hmm so if the round is already over, the mark is updated but the action is skipped. So a NEWER executed SetRound would still apply.

This is intentional: a newer round that is over should still supersede older ones. Round 3c.R1 says "a NEWER round already over is skipped, and the OLDER one after it is skipped too (it was superseded)".

Hmm OK.

But wait, what's the rationale for updating the mark when the round is already over? Let me re-read the comment:
```rust
// It may not also mark a round that is already over, OR revive
// one a newer proposal has replaced.
```

Hmm actually the comment is gone now. Let me just analyze the code.

If we don't update the mark when round is over:
- Last_round_id stays at the previous mark.
- A newer executed SetRound (which is not over) would set last_round_id = id (newer).
- An older SetRound (id < newer.id) was superseded. Skip.

If we DO update the mark when round is over:
- Last_round_id = current id (the over-round one).
- A newer executed SetRound (which is not over) would set last_round_id = id (newer).
- An older SetRound (id < newer.id) was superseded. Skip.

The result is the same in both cases for subsequent newer SetRound proposals.

But what about older SetRound proposals with id BETWEEN the over-round and the newer-set?

For example, say last_round_id = 5 (older). Now we execute SetRound proposal id = 7. But it's already over. Mark becomes 6.

Wait, that's wrong. The mark would become 6, not 7. Hmm but the code says:
```rust
cfg.last_round_id = id;
```

So `cfg.last_round_id = 7`. Not 6.

Hmm let me re-read:
```rust
if id <= cfg.last_round_id { skipped(id, "set_round", "superseded"); continue; }
cfg.last_round_id = id;
if *closes_at <= now { skipped(id, "set_round", "round_already_over"); continue; }
```

So first check `id <= last_round_id`. If yes, skip (don't update mark). Else update mark (last_round_id = id). Then check over-round. If over, skip.

So if id > old, it marks updated to id. Then if over-round, skipped.

Hmm OK so this is fine.

Now let me look at SetBoostTerms:
```rust
ProposalAction::SetBoostTerms { price, weight, epochs } => {
    if id <= cfg.last_boost_id { skipped(id, "set_boost_terms", "superseded"); continue; }
    cfg.last_boost_id = id;
    let mut d = IX_SET_BOOST_TERMS.to_vec();
    d.extend_from_slice(&price.to_le_bytes());
    d.push(*weight);
    d.extend_from_slice(&epochs.to_le_bytes());
    calls.push(d);
}
```

So if not superseded, update mark and push. No additional checks.

OK.

Now let me look at a potential issue: the restart halves.

```rust
let mut sales = *restart_sales;
let mut sweep = *restart_sweep;
if sales && stops.sales_stopped && stops.sales_stopped_at >= p.created_at {
    skipped(id, "restart_sales", "stop_is_newer"); sales = false;
}
if sweep && stops.sweep_stopped && stops.sweep_stopped_at >= p.created_at {
    skipped(id, "restart_sweep", "stop_is_newer"); sweep = false;
}
if sales || sweep {
    let mut d = IX_RESTART.to_vec();
    d.push(u8::from(sales));
    d.push(u8::from(sweep));
    d.extend_from_slice(&p.created_at.to_le_bytes());
    calls.push(d);
}
```

So if the stop is NEWER than the proposal (stop at >= proposal creation), skip that restart.

Note: `>=`, not `>`. So if stop at exactly proposal creation, the stop wins the tie. MINT's restart also uses `>=`:
```rust
if sales && c.sales_stopped {
    require!(c.sales_stopped_at < proposal_created_at, MintError::StopIsNewer);
}
```

MINT uses `<` (strict older). GOV uses `>=` (newer or equal).

Hmm inconsistency. Let me check.

In MINT:
```rust
if sales && c.sales_stopped {
    require!(c.sales_stopped_at < proposal_created_at, MintError::StopIsNewer);
}
if sweep && c.sweep_stopped {
    require!(c.sweep_stopped_at < proposal_created_at, MintError::StopIsNewer);
}
```

So MINT refuses if sales_stopped_at >= proposal_created_at (stop at the same second or later).

In GOV:
```rust
if sales && stops.sales_stopped && stops.sales_stopped_at >= p.created_at {
    skipped(id, "restart_sales", "stop_is_newer"); sales = false;
}
if sweep && stops.sweep_stopped && stops.sweep_stopped_at >= p.created_at {
    skipped(id, "restart_sweep", "stop_is_newer"); sweep = false;
}
```

So GOV skips if sales_stopped_at >= proposal_created_at.

So both MINT and GOV refuse/skip if sales_stopped_at >= proposal_created_at. Both use >=. OK consistent.

But wait, MINT uses `<` inside the `require!` macro. Let me re-read:
```rust
require!(c.sales_stopped_at < proposal_created_at, MintError::StopIsNewer);
```

So MINT requires `sales_stopped_at < proposal_created_at`. So refuses if NOT (<). I.e., refuses if >=.

GOV: `if sales && stops.sales_stopped && stops.sales_stopped_at >= p.created_at { skipped }`. So skips if >=.

Both refuse if >=. Consistent.

OK no issue.

Now let me look at another potential issue: the GOV's executor.

```rust
let id = p.id;
let stops = read_stops(&ctx.accounts.mint_config)?;
let cfg = &mut ctx.accounts.config;
let mut calls: Vec<Vec<u8>> = Vec::new();
for a in p.actions.iter() {
    ...
}
p.executed = true;
for data in calls {
    invoke_signed(
        &Instruction {
            program_id: MINT_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.mint_config.key(), false),
                AccountMeta::new_readonly(gov_pda, true),
            ],
            data,
        },
        &[ctx.accounts.mint_config.to_account_info(), ctx.accounts.governance.to_account_info()],
        &[&[GOV_SEED, &[gov_bump]]],
    )?;
}
```

So GOV:
1. Builds call list.
2. Sets p.executed = true.
3. Invokes each call via CPI to MINT.

If any invoke_signed fails, the entire tx reverts. Including p.executed = true.

Hmm but p.executed = true was set BEFORE the CPI. If the CPI fails, the state mutation is reverted. So p.executed = false on chain.

OK so this works.

But wait, p.executed = true is set even if some actions were skipped. So an executed proposal with all skips still marks executed.

Hmm the comment says:
```rust
// A whole proposal of nothing but skips still counts as executed: the vote's
// decision has been overtaken, which is an outcome, not an error.
```

OK so this is intentional.

Now let me look at the MINT's execute_proposal equivalents:

Looking at MINT, it doesn't have an execute_proposal instruction. The execution is via CPI from GOV.

So the order is:
1. GOV.execute_proposal is called.
2. GOV builds calls (skipping some actions).
3. GOV sets p.executed = true.
4. GOV invokes MINT's instructions via CPI, signed by GOV_PDA.

For each MINT instruction:
- set_round: requires price >= floor, cap > 0, window valid.
- restart: requires stop is older.
- arm_guardian / arm_swap_operator: requires valid args, sets pending.
- tighten_sweep: requires tighter.
- set_boost_terms: requires terms within bounds.

If any fails, the entire tx reverts.

Hmm but the proposal is marked executed. So even with skips, it's executed. If a call fails, the whole tx reverts, including the executed marking.

OK.

Now let me look at the seal check more carefully:

```rust
fn check_seal_wiring(seal_config: &UncheckedAccount, collection: &Pubkey) -> Result<()> {
    let (expected_cfg, _) = Pubkey::find_program_address(&[SEAL_CONFIG_SEED], &SEAL_PROGRAM_ID);
    require_keys_eq!(seal_config.key(), expected_cfg, MintError::BadSealConfig);
    require_keys_eq!(*seal_config.owner, SEAL_PROGRAM_ID, MintError::BadSealConfig);
    let d = seal_config.try_borrow_data()?;
    require!(d.len() >= OFF_COLLECTION + 32, MintError::BadSealConfig);
    require!(d[..8] == SEAL_CONFIG_DISC, MintError::BadSealConfig);
    require!(d[OFF_VERSION] == SEAL_CONFIG_VERSION, MintError::SealConfigVersion);
    let mut c = [0u8; 32]; c.copy_from_slice(&d[OFF_COLLECTION..OFF_COLLECTION + 32]);
    require_keys_eq!(Pubkey::new_from_array(c), *collection, MintError::WiringDiverged);
    Ok(())
}
```

So MINT's initialize calls check_seal_wiring to ensure SEAL's config matches MINT's collection.

And MINT's burn_vault requires `check_seal_wiring`... actually let me look.

Hmm, in BURN, the seal_config is checked separately:
```rust
require!((d[OFF_VERSION] == SEAL_CONFIG_VERSION), BurnError::SealConfigVersion);
```

So BURN reads SEAL config and checks version.

And in burn_vault (in BURN):
```rust
let reserves: Vec<Pubkey> = {
    let (expected_cfg, _) = Pubkey::find_program_address(&[SEAL_CONFIG_SEED], &SEAL_PROGRAM_ID);
    require_keys_eq!(ctx.accounts.seal_config.key(), expected_cfg, BurnError::BadSealConfig);
    require_keys_eq!(*ctx.accounts.seal_config.owner, SEAL_PROGRAM_ID, BurnError::BadSealConfig);
    let d = ctx.accounts.seal_config.try_borrow_data()?;
    require!(d.len() >= OFF_RESERVES + 4, BurnError::BadSealConfig);
    require!(d[..8] == SEAL_CONFIG_DISC, BurnError::BadSealConfig);
    require!(d[OFF_VERSION] == SEAL_CONFIG_VERSION, BurnError::SealConfigVersion);
    let mut c = [0u8; 32]; c.copy_from_slice(&d[OFF_COLLECTION..OFF_COLLECTION + 32]);
    require_keys_eq!(Pubkey::new_from_array(c), collection_cfg, BurnError::WiringDiverged);
    ...
};
```

So BURN reads SEAL's config at burn_vault time too. Redundant but OK.

Now let me look at another potential issue. Let me look at the snapshot for vault records used in voting.

```rust
let voters=VAULTS.filter(v=>{const r=await recOf(v.asset); if(!r||r[OFF_REC_INDEX]>=snapshot) continue
  const a=await conn.getAccountInfo(v.asset,CM); if(!a||a.data[0]!==1||!new W(a.data.subarray(1,33)).equals(k)) continue; return true})
```

Hmm the voters() function returns vaults the caller holds (with current owner matching) AND with mint_index < snapshot.

But this requires:
- r exists.
- r[OFF_REC_INDEX] < snapshot (i.e., vault was minted before proposal opened).
- a exists and is a live asset (data[0] === 1).
- a's owner bytes match caller's pubkey.

This is checked at vote time. So a vault can vote if all these hold at the moment of voting.

So if a vault is transferred AFTER proposal opened, the new owner can vote (since the new owner matches the bytes).

But if the vault was transferred back to the proposer or to someone else, the owner check changes.

Hmm but the mint_index check prevents vaults minted AFTER the proposal from voting. So vaults minted mid-vote (during the voting window) cannot vote even if they exist.

OK.

Now let me look at another potential issue. In the boost, the buyer's terms are checked at purchase time:

```rust
require!(price <= max_price && extra >= min_weight && epochs >= min_epochs, MintError::BoostTermsMoved);
```

So if the boost terms become WORSE for them (price increased, weight decreased, epochs decreased), the boost is refused.

But if the boost terms become BETTER (price decreased, weight increased, epochs increased), the boost is NOT refused. The boost is bought at the new (cheaper) price.

This is the "one-sided" rule per round 23, F11.

The suite tests this in BO.30b (terms moved against -> refused) and BO.30a (terms moved for -> lands).

Hmm OK.

Now let me look at a subtle issue with the `claim` function's owed_paid tracking:

```rust
owed_paid = owed_paid.checked_add(settled).ok_or(MintError::Overflow)?;
paid = paid.checked_add(pay).ok_or(MintError::Overflow)?;
```

So owed_paid sums settled (scaled), and paid sums pay (sats).

After all pairs processed:
```rust
let c = &mut ctx.accounts.config;
c.owed_scaled = c.owed_scaled.checked_sub(owed_paid).ok_or(MintError::Overflow)?;
```

So owed_scaled is decremented by the total settled.

But wait, the settled is pay * SCALE. And owed_scaled is in scaled units. So this works.

But there's a potential issue with multiple accounts, where some are frozen. Frozen accounts are deferred (not paid). The non-frozen ones are paid.

If all are frozen: owed_paid = 0. owed_scaled unchanged. OK.

If some are frozen and some are paid: owed_paid = sum of paid ones. owed_scaled decreased by that.

But the frozen ones are still owed. Their debt hasn't been touched.

Hmm wait, the frozen accounts' debt is the FULL pending (including the boost's contribution if any). So when they're paid later, they get the full amount.

But in the meantime, the owed_scaled reflects the pool's owed amount (excluding the frozen ones).

Hmm but owed_scaled is what the pool "owes" in aggregate. If a vault's share is owed but the vault is frozen, the pool still owes that amount.

So owed_scaled should NOT be decremented when the claim is deferred.

In the code:
```rust
if d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN {
    msg!(...);
    emit!(ClaimDeferred { asset: r.asset, owed: pay });
    n_deferred += 1;
    if touched { store_record(ri, &r)?; }
    continue;
}
```

The deferred case continues (skipping the payment). owed_paid not incremented. owed_scaled not decremented.

OK correct.

Hmm let me also check: what about a vault that's active but has pay = 0 (all in carry)?

```rust
let pending = owed_of(&r, acc)?;
let pay = (pending / ACC_SCALE) as u64;
if pay == 0 { if touched { store_record(ri, &r)?; } continue; }
```

If pay == 0, continue. owed_paid not incremented. owed_scaled not decremented.

But the vault's pending was non-zero (some dust owed). The pool's owed_scaled should track this.

Actually wait, owed_of returns the pending in SCALED units. pay = pending / SCALE (sats). If pending < SCALE, pay = 0.

The vault's carry holds pending (since debt was reset to weight * acc, and the carry has the previous owed).

So if pending < SCALE, the vault's pending is all in carry (sub-sat dust).

The pool's owed_scaled doesn't need to be decremented for this vault (since it's not being paid any sats).

But the carry remains. The next distribute, acc grows. The next claim, pending = new weight * acc + carry - debt. carry may grow further.

So eventually pay > 0 and the carry is paid.

Hmm OK this is consistent.

Now let me think about another potential issue. Let me look at the redeem_redeemed's interaction with claim.

In a redemption:
1. claim (MINT) - pays the vault's pending into the vault's ATA.
2. SE sweep (Core ExecuteV1, sweep helper) - moves all balances out.
3. burn_vault (BURN) - checks empty, calls retire_redeemed.

So between claim and burn_vault, the sweep runs. The sweep moves everything out.

But what if a stranger deposits something between claim and sweep? That deposit would be in the vault's ATA at the time of burn_vault. burn_vault would refuse (VaultNotEmpty).

Hmm but the sweep runs INSIDE the same transaction, so no external deposit can happen.

Wait actually the sweep is via Core ExecuteV1. The sweep runs in the SAME transaction. So no external deposit can land.

OK.

But what if the claim's pay is wrong because the pool doesn't have enough? E.g., balance < owed_sats at the time of transfer. SPL Token's TransferChecked would fail.

Hmm but claim checks `avail = balance - ceil(owed_scaled)`. So balance >= avail. The transfer is from avail amount. So balance is sufficient.

OK.

Now let me look at a potential issue with the redemption claim being skipped.

If the pool is frozen:
- claim's pay transfer to vault fails (SPL Token's TransferChecked refuses from frozen source).

Hmm wait, the redeem flow: if pool is frozen, claim can't be made (would fail). So the redemption must leave claim out (per SPEC).

If claim is omitted from the redemption:
- burn_vault runs.
- retire_redeemed is called.
- forfeit = pool_is_frozen(...) = true.
- retire(redeemed=true, forfeit=true). 
- The pending share is forfeited to the pool (owed_scaled -= pending, but pending stays in the pool's debt tracking).

Actually let me re-read retire:
```rust
fn retire(c: &mut MintConfig, r: &mut VaultRecord, redeemed: bool, forfeit: bool) -> Result<()> {
    require!(!r.retired, MintError::AlreadyRetired);
    let mut returned: u128 = 0;
    if r.active {
        let w = weight_of(r)?;
        let full = (w as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
        let pending = owed_of(r, c.acc_scaled)?;
        if redeemed && !forfeit { require!(pending < ACC_SCALE, MintError::ClaimBeforeBurn); }
        if forfeit && pending >= ACC_SCALE {
            msg!("CBOB_REDEEMED_POOL_FROZEN asset={} forfeited_sats={}", r.asset, pending / ACC_SCALE);
        }
        c.owed_scaled = c.owed_scaled.checked_sub(pending).ok_or(MintError::Overflow)?;
        c.total_active_weight = c.total_active_weight.checked_sub(w).ok_or(MintError::Overflow)?;
        c.active_count = c.active_count.checked_sub(1).ok_or(MintError::Overflow)?;
        if r.boost_weight > 0 { unschedule_boost(c, r)?; }
        r.debt_scaled = full;
        r.carry_scaled = 0;
        r.active = false;
        returned = pending;
    }
    if r.pending {
        c.pending_count = c.pending_count.checked_sub(1).ok_or(MintError::Overflow)?;
        if r.request_epoch == c.dist_epoch {
            c.pending_this_epoch = c.pending_this_epoch.checked_sub(1).ok_or(MintError::Overflow)?;
        }
        r.pending = false;
    }
    r.retired = true;
    if !redeemed { c.bare_burns_retired = c.bare_burns_retired.checked_add(1).ok_or(MintError::Overflow)?; }
    emit!(VaultRetired { asset: r.asset, redeemed, returned_to_pool_sats: (returned / ACC_SCALE) as u64,
        total_weight: c.total_active_weight, bare_burns_retired: c.bare_burns_retired });
    Ok(())
}
```

So for redeemed && !forfeit: require pending < ACC_SCALE (less than 1 sat owed). Forfeit allows it.

For forfeit && pending >= ACC_SCALE: log "CBOB_REDEEMED_POOL_FROZEN".

owed_scaled -= pending. So the owed is removed from the bookkeeping.

But the forfeited amount stays in the pool's balance (since no transfer happened). So pool balance stays the same, owed_scaled decreases. Next distribute, avail increases by forfeited amount (after rounding).

So the forfeited amount is shared by future distributes.

OK this is consistent.

Now let me think about another potential issue. What about when the boost's expiry and the vault's retire race?

A vault with a boost retires (bare burn). retire calls unschedule_boost. The boost is unscheduled.

But what if the boost was due (in boosts_due)? Then unschedule_boost decrements boosts_due.

Hmm but if the boost was due and the vault is bare-burning, the boost should have been expired already.

Actually, the round_29 D1 special-cases this: SPEC 47 mentions a frozen PAUSED sale, and the boost expiry logic.

Actually, looking at item 27 in the accepted limits: "A boost leaves with the vault, from wherever it is in the schedule." And "If redeemed && !forfeit { require!(pending < ACC_SCALE, MintError::ClaimBeforeBurn); }".

So if a redeemed vault has a pending share, claim must have been called first.

OK.

Now let me look at another thing. Let me look at the `claim_charter_vault` for the PoolTokenCheck:

The PoB burn via CPI uses an instruction with the PoB asset as a non-signer. Let me check.

```rust
{
    let mut metas = vec![
        AccountMeta::new(pob, false),
        AccountMeta::new(ctx.accounts.pob_collection.key(), false),
        AccountMeta::new(ctx.accounts.payer.key(), true),
        AccountMeta::new_readonly(ctx.accounts.owner.key(), true),
        AccountMeta::new_readonly(MPL_CORE_ID, false),
        AccountMeta::new_readonly(MPL_CORE_ID, false),
    ];
    let mut infos = vec![
        ctx.accounts.pob_asset.to_account_info(),
        ctx.accounts.pob_collection.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.owner.to_account_info(),
        ctx.accounts.mpl_core.to_account_info(),
    ];
    for a in extra.iter() {
        // NEVER as a signer: a pass-through account must not carry any
        // authority into Core that the caller did not already hold.
        metas.push(if a.is_writable { AccountMeta::new(a.key(), false) } else { AccountMeta::new_readonly(a.key(), false) });
        infos.push(a.clone());
    }
    invoke(&Instruction { program_id: MPL_CORE_ID, accounts: metas, data: vec![IX_BURN_V1, 0] }, &infos)?;
}
```

So PoB burn:
- PoB asset (non-signer, writable).
- PoB collection (non-signer, writable).
- Payer (signer, writable).
- Owner (signer, readonly).
- 2 MPL_CORE accounts (readonly).
- Extras (non-signer).

Then calls Core's BurnV1.

Core's BurnV1 checks:
- Asset owner (signer).
- Asset is in collection (collection writable).

So owner signs. If owner doesn't sign or if they aren't the asset owner, Core refuses.

Then the extra accounts are passed through. These are external plugin accounts that may be checked by Core's BurnV1.

OK.

But wait, what about `pob_extra` validation?

```rust
require!(n_extra <= MAX_POB_EXTRA && n_extra <= ctx.remaining_accounts.len(), MintError::BadPobExtra);
```

So `n_extra` (from data) is bounded and matches the number of extra accounts.

So if a charter claim with pob_extra > 0, the extras are passed through. If the extras aren't passed, BadPobExtra.

Good.

Let me look at one more thing: the PoB Merkle verification.

```rust
fn merkle_root_from(mut node: [u8; 32], proof: &[[u8; 32]]) -> [u8; 32] {
    for sib in proof.iter() {
        node = if node <= *sib {
            hashv(&[&[MERKLE_NODE_TAG], &node, sib]).to_bytes()
        } else {
            hashv(&[&[MERKLE_NODE_TAG], sib, &node]).to_bytes()
        };
    }
    node
}
```

This is a Merkle proof verification with domain-separated node hashes.

Compare with scripts/pob-merkle.mjs:
```js
const nodeOf = (a, b) => Buffer.compare(a, b) <= 0
  ? H(Buffer.from([0x01]), a, b) : H(Buffer.from([0x01]), b, a)
```

So Rust's `node <= *sib` should match JS's `Buffer.compare(a, b) <= 0`. ✓

And:
```js
function verify(pubkeyBytes, proof, root) {
  let n = leafOf(pubkeyBytes)
  for (const s of proof) n = nodeOf(n, s)
  return n.equals(root)
}
```

JS's verify iterates through the proof, hashing with sorted pairs.

Rust's merkle_root_from does the same. ✓

OK Merkle verification is consistent.

Now let me think about one more potential issue. Let me look at the boost's effect on the redemption cap (the rolling window).

The rolling window is checked in BURN's burn_vault. It reads MINT config's minted_total, BURN config's burned_total, MINT config's bare_burns_retired.

```rust
let (minted_total, bare_retired) = read_mint_supply(&ctx.accounts.mint_config)?;
let live = minted_total - ctx.accounts.config.burned_total - bare_retired;
let cap = live * (12000 - ...) / 10000; // 2.1%
```

Wait let me re-read:
```rust
let (minted_total, bare_retired) = read_mint_supply(&ctx.accounts.mint_config)?;
let live = minted_total.checked_sub(ctx.accounts.config.burned_total).ok_or(BurnError::Overflow)?
    .checked_sub(bare_retired).ok_or(BurnError::Overflow)?;
let cap = live.checked_mul(REDEEM_RATE_BPS).ok_or(BurnError::Overflow)?
    .checked_add(9_999).ok_or(BurnError::Overflow)? / 10_000;
```

So cap = ceil(live * 210 / 10000) = ceil(live * 0.021).

Then check ring:
```rust
let k = (cap.max(1) as usize).min(RATE_RING);
let c = &mut ctx.accounts.config;
let now = Clock::get()?.unix_timestamp;
let head = c.rate_head as usize % RATE_RING;
let kth = c.rate_ring[(head + RATE_RING - k) % RATE_RING];
require!(now.checked_sub(kth).ok_or(BurnError::Overflow)? >= c.redeem_window_secs, BurnError::RateLimited);
c.rate_ring[head] = now;
c.rate_head = ((head + 1) % RATE_RING) as u8;
```

So check the kth-most-recent redemption. If it's older than redeem_window_secs, allow.

Then store the new redemption.

Now let me think: the ring is of size RATE_RING = 64. So at most 64 redemptions are remembered.

If cap > 64 (live > 3047), the limit is STRICTER (per the test SPEC). The k = min(cap, 64). So if cap = 100, k = 64.

But the spec says "The ring bounds the cap at 64, which covers a live supply of 3,047, and the supply is fixed at 2,100 (cap 45). Past it the limit is STRICTER, never looser."

So at cap > 64, the effective limit is 64 (smaller than the true cap). This is stricter.

OK so the limit is bounded above by 64 redemptions per window.

Hmm but what if cap < 64? E.g., cap = 10. Then we check the 10th most recent. If 0 < 10 < ring, the 10th most recent exists. If ring has fewer than 10 entries, the ring's uninitialized entries are 0 (which is much older than now).

So if ring has 5 entries, the "10th most recent" is 0. Now - 0 >= window? Yes (very old). So allowed.

Hmm so this is correct: cap = 10 means we allow at most 10 redemptions per window, and 5 haven't happened yet in the window.

OK.

But wait, the head pointer is at head + 1 (mod 64) after each redemption. So after 64 redemptions, head wraps around. The OLDEST entries get overwritten.

If cap = 64 and we have 64 redemptions in the window, the kth = 1 (most recent). 1st redemption's time. Now - 1st < window? Depends.

Hmm let me think more carefully.

The kth-most-recent: k = cap (or 64 if cap > 64). If cap = 64, k = 64. 64th-most-recent = oldest in the ring.

If head = 5 (next write at index 5), then ring[0..5] are the 5 most recent. ring[5..64] = ring[5..64] are entries 6 to 64.

Wait, ring[head + RATE_RING - k] % RATE_RING. With head = 5, k = 64: ring[(5 + 64 - 64) % 64] = ring[5] = most recent (since head is the next write location, ring[head-1] is the most recent).

Hmm let me re-think. head = next write index. So ring[head - 1] = most recent redemption.

Wait, after each redemption: head = (head + 1) % RATE_RING.

So ring[head] = new redemption. So ring[head] is most recent. The NEXT write is at head. So ring[(head - 1) % RATE_RING] is the most recent redemption.

Actually let me re-read:
```rust
let head = c.rate_head as usize % RATE_RING;
let kth = c.rate_ring[(head + RATE_RING - k) % RATE_RING];
```

So kth = ring[(head + 64 - k) % 64].

If k = 1 (most recent): kth = ring[(head + 63) % 64] = ring[head - 1] = the most recent. ✓

If k = 64 (least recent in full ring): kth = ring[head] = the just-written entry. Wait, head is the next write location.

Hmm let me re-think. Before the new redemption:
- ring[head - 1] is the most recent.
- ring[(head - 2) % 64] is the 2nd most recent.
- ring[(head - k) % 64] is the kth most recent.

After the new redemption (which writes to ring[head], then increments head):
- ring[(head - 1) % 64] is the just-written.
- ring[(head - 2) % 64] is the 2nd most recent.
- ring[(head - k) % 64] is the kth most recent.

OK so ring[(head - k) % 64] = ring[(head + 64 - k) % 64] = the kth most recent. ✓

So the code is correct.

Hmm but wait, before the new redemption, head is at the position where the NEW redemption will be written. ring[head - 1] is the most recent previous. So `kth = ring[(head + 64 - 1) % 64] = ring[head - 1]` for k = 1.

After the new write to ring[head], head becomes (head + 1). ring[(head - 1) % 64] = the just-written.

So the check is done before writing. The check uses the state BEFORE the new redemption.

For k = 1: kth = ring[head - 1] = the most recent previous. If now - most_recent < window: too soon (1 already in window). Refuse.

For k = cap: kth = ring[head - cap]. If cap entries in window: now - cap_recent < window. Refuse.

OK so the check uses PREVIOUS state (not including the current). The check ensures the kth most recent previous is at least window ago.

Then writes the new entry. So if the check passes, the new entry is now part of the count.

Hmm so after the new write, there are cap + 1 entries in the window (the cap previous + the new). But the new is "now", so it's not "in the window" yet.

Actually "in the window" = entries with time > now - window. Since the new entry has time = now, now - now = 0 < window. So it IS in the window.

So after the write, there are cap entries in the window that are at least 0 seconds old. But the cap+1th entry (if any) is older than window.

Hmm I'm confusing myself. Let me re-think.

The check: kth = ring[(head - k) % 64] is the kth most recent PREVIOUS redemption. If now - kth >= window: the kth most recent is older than window. There are at most k-1 previous redemptions in the window.

If now - kth < window: the kth most recent is within window. There are at least k previous redemptions in the window. Refuse.

After writing the new entry, head advances. The new entry is at ring[(head - 1) % 64].

Now the count of redemptions in the window is the previous count + 1 (the new entry).

So if the check passed, the previous count was <= k - 1. So the new count is <= k.

But the new count should be <= k (the cap). So the new count is allowed.

Hmm but the check was "now - kth >= window". If this passes, the kth most recent previous is older than window. So previous count < k. So new count <= k. OK.

If the check fails, the kth most recent previous is within window. So previous count >= k. The new would make it k+1 > k. Refuse.

OK so the check is correct.

But wait, the cap is `ceil(live * 210 / 10000)`. For live = 100, cap = ceil(21) = 2. Wait, 100 * 210 / 10000 = 21.0, ceil = 21. Wait, 100 * 210 = 21000. 21000 / 10000 = 2.1, but with (numerator) // ... hmm. 21000 / 10000 = 2, 21000 % 10000 = 1000. So 21000 / 10000 = 2. Then + 9999 = 10999. 10999 / 10000 = 1. So (21000 + 9999) / 10000 = 1. Hmm.

Wait, let me re-compute. (21000 * 1 + 9999) / 10000 = (21000 + 9999) / 10000 = 30999 / 10000 = 3. So cap = 3 for live = 100.

Hmm so cap = ceil(live * 210 / 10000) = ceil(210 / 100) = ceil(3) = 3. But my code computed 3 via (21000 + 9999) / 10000. So it gives 3.

OK so the cap is correctly computed.

For live = 1, cap = ceil(21 / 10000). (21 + 9999) / 10000 = 10020 / 10000 = 1. cap = 1. min with 64 = 1. ✓

For live = 1000, cap = ceil(21000 / 10000) = 3 (since 21000 = 2 * 10000 + 1000, so + 9999 gives 30999, / 10000 = 3). cap = 3. min 64 = 3. ✓

For live = 47, cap = ceil(987 / 10000). (987 + 9999) / 10000 = 10986 / 10000 = 1. cap = 1.

For live = 48, cap = ceil(1008 / 10000). (1008 + 9999) / 10000 = 11007 / 10000 = 1. cap = 1.

For live = 2100, cap = ceil(441000 / 10000) = 45 (since 441000 = 44 * 10000 + 1000, + 9999 = 450999, / 10000 = 45). cap = 45. min 64 = 45. ✓

OK the cap computation is correct.

Now let me think about one more potential issue. Let me look at how the SOL round caps interact with $CBOB mint etc.

Hmm I think we've covered the major areas. Let me now consider the prompt requirements more carefully.

The prompt asks for FIND FAULTS. It also says:
> A finding you decline to write because "someone else will catch it" is a finding nobody writes.

So I should look for any potential issues. Let me look at a few more areas.

Let me look at the sweep helper more carefully.

```rust
const IX_TRANSFER: u8 = 3;
const IX_CLOSE_ACCOUNT: u8 = 9;

pub fn process(_program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data != [0] { return Err(ProgramError::InvalidInstructionData); }
    if accounts.len() < 4 || (accounts.len() - 4) % 2 != 0 { return Err(ProgramError::NotEnoughAccountKeys); }
    let (signer, dest, token, system) = (&accounts[0], &accounts[1], &accounts[2], &accounts[3]);
    if !signer.is_signer { return Err(ProgramError::MissingRequiredSignature); }
    if *token.key != SPL_TOKEN_ID || *system.key != system_program::ID { return Err(ProgramError::IncorrectProgramId); }
    if signer.key == dest.key { return Err(ProgramError::InvalidArgument); }
    for pair in accounts[4..].chunks(2) {
        let (src, to) = (&pair[0], &pair[1]);
        let (src_mint, src_owner, amount) = read_token(src)?;
        let (to_mint, to_owner, _) = read_token(to)?;
        if src_owner != *signer.key { msg!("CBOB_SWEEP refused: source {} is not the vault's", src.key); return Err(ProgramError::IllegalOwner); }
        if to_owner != *dest.key || to_mint != src_mint {
            msg!("CBOB_SWEEP refused: destination {} is not the wallet's account for that mint", to.key);
            return Err(ProgramError::InvalidAccountData);
        }
        if amount > 0 {
            let mut d = vec![IX_TRANSFER]; d.extend_from_slice(&amount.to_le_bytes());
            invoke(&Instruction { ... })?;
        }
        invoke(&Instruction { program_id: SPL_TOKEN_ID, data: vec![IX_CLOSE_ACCOUNT], ... })?;
        msg!("CBOB_SWEEP token mint={} amount={}", src_mint, amount);
    }
    let lamports = signer.lamports();
    if lamports > 0 {
        invoke(&system_instruction::transfer(signer.key, dest.key, lamports), &[...])?;
    }
    msg!("CBOB_SWEEP lamports={}", lamports);
    Ok(())
}
```

So sweep helper:
1. data must be [0].
2. Need at least 4 accounts (signer, dest, token, system) + even pairs.
3. Signer must sign.
4. Token program must be classic SPL. System program must be system.
5. Signer must not equal dest.
6. For each pair (source, to):
   - Read source token account (mint, owner).
   - Read to token account (mint, owner).
   - Source must be owned by signer.
   - Destination must be owned by dest, same mint as source.
   - If amount > 0, transfer all.
   - Close source.
7. Transfer all lamports from signer to dest.

Hmm OK looks straightforward.

But wait, what if the destination token account's owner is correct, but the destination token account is FROZEN?

The SPL Token Transfer would fail (frozen). The tx reverts.

OK that's fine.

What if the destination token account doesn't exist? The transfer would fail. The tx reverts.

OK.

What if source has amount 0? Then the transfer is skipped, but close is still attempted. Close source closes the source account. Rent refunded to dest (the destination owner).

OK.

What if source is already closed? read_token tries to read the data. If data is 0 bytes or doesn't match length, returns error.

OK.

What if dest is not signer (not Core ExecuteV1)? Then signer.is_signer = false. Returned as MissingRequiredSignature.

So the sweep helper can only be called via Core ExecuteV1.

But what if the dest is also the signer? Returned as InvalidArgument (signer.key == dest.key).

OK so different wallets.

Hmm what about Core's ExecuteV1 with the sweeper not signed by Core? Wait, the asset_signer PDA is what Core signs for (in ExecuteV1, the asset_signer is a signer). So when the helper is called via ExecuteV1, signer is the asset_signer PDA.

The asset_signer PDA is the vault's PDA. It owns the vault's token accounts.

OK so the helper moves the vault's tokens to dest (the redeemer's wallet).

Now let me check the SR.1 precondition: called directly.

```rust
const direct=const call=await att(()=>send([sweepIx(v,alice.publicKey,[[ata(v.pda),ata(alice.publicKey)]],false)],[alice]))
rec('SR.1','the helper called DIRECTLY, not through Core (nobody can sign for the vault wallet)','REJECT,'+heldT,...)
```

So direct call: alice signs (not the vault PDA). sweepIx has signer = true (alice). The transfer attempts: src.owner is alice (the signer), so SRC passes. But src.owner must equal signer.key (alice). Passes.

Hmm but actually src is the vault's ATA, which is owned by v.pda. So src.owner (the PDA) != alice (the signer).

So the SRC owner check fails: `src_owner != signer.key`. IllegalOwner error.

So the direct call is refused (IllegalOwner).

But wait, the test asserts "REJECT," + heldT. The heldT is the original balance (before the griefer's dust). So expects the vault to still hold heldT.

After the rejected call, the vault still holds heldT (no transfers happened). ✓

OK.

Now let me check SR.2: "a redemption whose sweep names, as the destination, an account the named destination wallet does NOT own (bob's, for alice)".

```rust
const elsewhere=await att(()=>send([ixOpen(T,alice.publicKey),...viaCore(T,sweepIx(T,alice.publicKey,[[ata(T.pda),ata(bob.publicKey)]])),ixBurn(T,alice.publicKey,declare(T.pda))],[alice]))
rec('SR.2','a redemption whose sweep names, as the destination, an account the named destination wallet does NOT own (bob\'s, for alice)','REJECT,'+heldT,...)
```

So sweep helper names ata(bob.publicKey) as destination. But sweepIx's dest is alice.publicKey (the named destination wallet). Sweep helper checks `to_owner != dest.key`. To's owner is bob. dest is alice. to_owner != dest.key. So InvalidAccountData error.

OK so SR.2 fails.

Hmm wait, but the sweep helper also checks signer (the asset_signer PDA) signs. Since it's via ExecuteV1, signer is signer.is_signer = true (Core signs). OK.

But there's also the issue of bob's signature. The sweep helper doesn't require bob to sign (it's just the destination). So bob doesn't need to be a signer. The check is on ownership, not signature.

OK so SR.2 fails correctly.

Now SR.3: "(the defect) the exact-amount sweep, after 1 sat of dust landed: the opening FAILS".

```rust
await send([createTransferInstruction(ata(deployer.publicKey),ata(T.pda),deployer.publicKey,1n)],[deployer])
const stale=await att(()=>send([ixOpen(T,alice.publicKey),...sweep(T,heldT,0),ixBurn(T,alice.publicKey,declare(T.pda))],[alice]))
rec('SR.3','(the defect) the exact-amount sweep, after 1 sat of dust landed: the opening FAILS','REJECT',...)
```

So sweep(T, heldT, 0) means transfer AT amount and 0 lamports. But wait, sweep() in the test creates a SPL transfer instruction with amount = heldT and a close instruction. So it sweeps all the tokens.

Then ixBurn checks emptiness: v.pda.lamports() == 0 (true if no SOL added) and reserve accounts are empty.

But after the dust (1 sat of cbBTC to ata(T.pda)), the reserve has heldT + 1. The sweep transfers all of heldT + 1. So reserve is empty.

Hmm wait, sweep moves AMOUNT from src to dst. Then closes src. So after sweep, src has 0 amount.

So reserve is empty. Burn should succeed.

But the test expects the opening to FAIL. Let me re-read.

```typescript
const stale=await att(()=>send([ixOpen(T,alice.publicKey),...sweep(T,heldT,0),ixBurn(T,alice.publicKey,declare(T.pda))],[alice]))
```

So sweep(T, heldT, 0) is called. Let me look at sweep():
```typescript
const sweep=(v:V,legs:[W,bigint,boolean][],to:Keypair=v.owner)=>{
    const inner=outer.map<any>((m,i)=>{
      ...
    })
    ...
}
```

Hmm I don't see the full sweep function. Let me look at the actual sweep function in the test:

```typescript
const sweep=(v:V,amt:bigint,lam:number,close=true,to:Keypair=v.owner)=>{
    const ixs:any[]=[]
    if(amt>0n){ ixs.push(fromWeb3JsInstruction(createTransferInstruction(ata(v.pda),ata(to.publicKey),v.pda,amt)))
      if(close) ixs.push(fromWeb3JsInstruction(createCloseAccountInstruction(ata(v.pda),to.publicKey,v.pda))) }
    if(lam>0) system.transfer({fromPubkey:v.pda,toPubkey:to.publicKey,lamports:lam}).fromWeb3JsInstruction())
    return execute(umi,{asset:{publicKey:v.umiAsset},collection:{publicKey:coll.publicKey} as any,
      instructions:ixs,signers:[createNoopSigner(v.pdaU)],authority:U(v.owner),payer:U(v.owner)}).getInstructions().map(i=>new TransactionInstruction({...}))
}
```

So sweep(v, amt, lam, close, to):
- If amt > 0: SPL transfer(amt) + maybe close.
- If lam > 0: system transfer (lam lamports).
- Returns Core ExecuteV1 ixs.

For sweep(T, heldT, 0): transfer(heldT) + close. No lamports transfer.

Hmm so sweep moves heldT tokens. The dust of 1 sat is in addition (heldT + 1).

So sweep transfers heldT, not heldT + 1. The dust (1 sat) remains.

Then burn checks: ata(T.pda, CBBTC) has 1 sat. VaultNotEmpty.

OK so the burn refuses. The opening (with sweep) fails.

Yes SR.3 is the defect.

Now SR.4: "the SAME race through the helper: the opening lands, the owner gets everything INCLUDING the dust, the vault is burned".

```rust
const helperFor = (v) => ... // sweep helper version
const live=await att(()=>send([ixOpen(T,alice.publicKey),...viaCore(T,sweepIx(T,alice.publicKey,[[ata(T.pda),ata(alice.publicKey)]])),ixBurn(T,alice.publicKey,declare(T.pda))],[alice]))
```

So uses sweep helper with [[src=ata(T.pda), dst=ata(alice.publicKey)]]. Sweep helper reads live balance (heldT + 1 after dust), transfers all, closes.

Then burn: empty. OK.

So SR.4 succeeds. SR.3 fails. The helper solves the issue.

OK.

Now let me look at one more potential issue. Let me look at the Off-chain code (verify_off_chain).

Hmm actually let me look at the prompt requirements more carefully. The prompt mentions:
- 855-assertion suite
- 891 off-chain detector assertions
- 39 allocation
- 22 poster
- 14 PoB
- 47 launch
- 6 host unit tests
- 33 against live mainnet
- 4 expiry-budget assertions

And the assertions are behind floors that must EQUAL the count.

Let me also look at the round 29 verdict. Round 29 was NOT CLEAN, with M1 (medium), L1 (low), D1 and D2 (info).

The repairs for M1, L1, D1, D2 are in the round 29 commit.

Let me check if those repairs were actually applied correctly.

Let me look at `bank/txread.mjs`:

```javascript
export async function readParsedTransaction(conn, signature, options = {}) {
  if (typeof conn?._rpcRequest !== 'function') throw new Error('transaction RPC transport unavailable')
  const answer = await conn._rpcRequest('getTransaction', [signature,
    { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }])
  if (answer?.error) throw new Error(`getTransaction RPC error ${answer.error.code}: ${answer.error.message}`)
  need(object(answer) && Object.hasOwn(answer, 'result'), 'RPC envelope')
  return validateParsedTransaction(answer.result, signature, options)
}
```

OK so readParsedTransaction calls the RPC directly. If the transaction has truncated logs, validateParsedTransaction throws.

The repair for M1 should make this not fail the entire alarm pass. Let me check bank/alarm.mjs to see if it has the per-signature handling.

Hmm I don't have access to bank/alarm.mjs in the prompt. Let me look at what's in the prompt.

Actually, the prompt doesn't include bank/alarm.mjs. It includes a lot of programs, suite, sim, etc., but not the bank/ directory.

Hmm OK so I can't verify the M1 repair.

But the round 29 validation report says it was applied.

Hmm OK.

Let me look at the L1 repair. The audit-coverage.sh script should now enumerate all tracked files.

I don't have access to scripts/audit-coverage.sh in the prompt. Let me check.

OK so scripts/audit-coverage.sh is in the prompt! Let me re-look.

Actually wait, let me search the prompt for "scripts/audit-coverage.sh"...

Looking at the prompt content, scripts/audit-coverage.sh is included. Let me re-read it:

```bash
listed=$(git ls-files 'programs/*' 'bank/*' 'scripts/*' 'sim/*' 'launch/*' 'tests/*' \
      SPEC.md DESIGN-v6.md HOLDER-GUIDE.md Cargo.toml Anchor.toml) \
  || { echo "audit coverage: git could not list the tracked files; refusing to report coverage"; exit 2; }
have=$(printf '%s\n' "$listed" | { grep -vE '^scripts/audit|/Cargo\.lock$|^bank/\.gitignore$' || true; } | sed '/^$/d' | sort -u)
```

So `have` is enumerated from git ls-files of all those directories + a few top-level files. Then excludes scripts/audit*, Cargo.lock, bank/.gitignore.

Hmm but I noticed that the script doesn't include Cargo.toml or Anchor.toml from programs/ subdirectories, nor the program Cargo.toml files. Let me check.

The glob `programs/*` matches everything in the programs directory, including Cargo.toml files.

Wait actually `programs/*` matches files one level deep. So `programs/cbob-vaults/src/lib.rs` would not match `programs/*` (only `programs/cbob-vaults` would). Hmm.

Actually `programs/*` in bash matches immediate children. So it would match `programs/cbob-vaults`, `programs/cbob-vault-mint`, etc. but NOT files within them.

So the script enumerates the SUBDIRECTORIES of programs, not the files.

So Cargo.toml, Anchor.toml, etc. wouldn't be in `have`.

Hmm let me re-verify. The round 29 L1 says the audit-coverage.sh scope was hand-picked and missed `sim/fixtures.mjs`, `tests/cpi-wrapper/Cargo.toml`, `launch/cbob-token.mainnet.json`, `scripts/pob-set.json`, `Cargo.lock`, and the four non-helper `programs/*/Cargo.toml`.

Hmm but with my read of the script, it uses git ls-files with the patterns. So all files under those directories should be in the listing.

Let me re-check. `git ls-files 'programs/*'` lists files matching `programs/*`. In git, the glob is interpreted by git itself, not by the shell.

Git's `git ls-files 'programs/*'` would match all files under `programs/*/`, including Cargo.toml.

Actually wait, let me check. The git ls-files pattern `programs/*` matches anything one level deep. So `programs/cbob-vaults/Cargo.toml` would be listed.

So the script DOES include Cargo.toml files. Hmm.

Actually let me re-check by running git ls-files conceptually. `git ls-files 'programs/*'` would match files like `programs/cbob-vaults/Cargo.toml`. Yes, because the pattern includes the leading `programs/` and then `*` matches anything (including subdirectory paths).

OK so my interpretation is wrong. The script DOES include program Cargo.toml files.

Hmm so what does L1 actually fix?

The L1 in round 29 says:
> The coverage gate does not cover the files SPEC says it covers.
> SPEC's ship-gate table says `audit-coverage.sh` "diffs every audit prompt ever sent against the file tree and fails if anything has never been read"

So the gate has been refined to:
```bash
listed=$(git ls-files 'programs/*' 'bank/*' 'scripts/*' 'sim/*' 'launch/*' 'tests/*' \
      SPEC.md DESIGN-v6.md HOLDER-GUIDE.md Cargo.toml Anchor.toml)
```

These patterns enumerate the tracked files under those directories.

Hmm so the script should now include Cargo.toml files in `programs/*/Cargo.toml`. Good.

But what about the round 29 verdict's complaint about the "hand-picked set of globs"? The script uses `git ls-files` with these patterns, which should enumerate everything.

Hmm wait, but `Cargo.toml` is the WORKSPACE Cargo.toml. The script also includes it explicitly. Good.

So the script now enumerates all tracked files under programs/, bank/, scripts/, sim/, launch/, tests/, plus SPEC, DESIGN, holder guide, and workspace manifests.

What files are NOT in `have` after exclusions?
- scripts/audit*
- Cargo.lock (in any directory? or just top-level?)
- bank/.gitignore

Hmm Cargo.lock is included. Let me re-check.

```bash
have=$(printf '%s\n' "$listed" | { grep -vE '^scripts/audit|/Cargo\.lock$|^bank/\.gitignore$' || true; } | sed '/^$/d' | sort -u)
```

So exclusion regex is:
- ^scripts/audit (any path starting with scripts/audit)
- /Cargo.lock$ (any path ending with /Cargo.lock)
- ^bank/.gitignore$ (exact match)

So Cargo.lock files anywhere are excluded. bank/.gitignore is excluded. scripts/audit* are excluded.

OK so the script enumerates everything except audit runners, Cargo.lock files, and one .gitignore.

The script then compares against `sent` (the bundled files in audit prompts).

The complaint in round 29 was that sim/fixtures.mjs wasn't bundled. The repair probably was to bundle it.

OK so the L1 repair is in two parts:
1. The script enumerates all tracked files (which it does).
2. Every file must have been bundled.

If a file is tracked but never bundled, the script reports it.

The repair for L1 is to ensure all newly tracked files have been bundled in a round.

OK that's what the round 29 validation did.

So the round 29 repairs (M1 and L1) seem to be applied correctly.

Now let me focus on the actual audit. Let me look for more potential issues.

Let me look at the test simulation more carefully.

Actually let me look at the $CBOB_REDEEMED line in burn_vault:
```rust
msg!("CBOB_REDEEMED {}", ctx.accounts.vault_asset.key());
emit!(VaultBurned { asset: ctx.accounts.vault_asset.key(), owner: asset_owner, declared_accounts: declared,
    burned_total: c.burned_total });
```

So logs `CBOB_REDEEMED <asset>` and emits event.

For the public poster (X and CBOB website), the alarm or poster reads this log.

But what if the logs are truncated? Then the log might not be present, but the event might still be in the inner instructions.

Actually wait, transactions return events even with truncated logs (events are in inner instructions, not log messages).

Let me check. In Solana, transactions have `meta.logMessages` and `meta.innerInstructions` (which includes events).

If `meta.logMessages` is truncated, `meta.innerInstructions` might still have the events.

OK so the poster could read events instead of logs.

But the repair description in VALIDATION.md says the poster "never drafts from truncated logs; it queues a REJECTED hand-draft entry when BURN was invoked at the top level, and moves on."

So the poster checks if BURN was invoked at the top level (in inner instructions), then queues a hand-draft entry. Good.

OK so the M1 repair handles truncated logs for the poster too.

Now let me think about potential issues I haven't covered yet.

Let me look at the redeem page requirements (item 50). These are not built, and they require:
1. Prior transaction creating destination ATAs.
2. Claim (except when pool frozen).
3. Sweep through the helper.
4. Mind the legacy packet.
5. Close all reserve accounts.

These are obligations of the client (not the programs). If the client doesn't follow them, the redemption might fail.

But the programs themselves don't enforce these. The redeem page contract is informal.

Now let me look at another potential issue: the freeze authority of cbBTC.

The $GARY mint has no freeze authority (per the probe). What about $GIRAFFISH?

Per SPEC: "All three intended reserve mints (cbBTC, $GARY, $GIRAFFISH) are classic SPL, verified on mainnet."

But the freeze authority isn't necessarily NONE. Only $GARY is documented.

For cbBTC, freeze authority exists (Coinbase). So cbBTC accounts can be frozen.

For $GIRAFFISH, the probe doesn't say. Could have freeze authority or not.

Hmm but the program doesn't check freeze authority of the reserve mints. Only checks the asset owner is SPL Token.

So if $GIRAFFISH has a freeze authority, a $GIRAFFISH account could be frozen. The claim flow would defer the payment (per the freeze check).

Hmm OK.

Let me look at a potential issue with the boost's expiry in `claim`:

```rust
let mut touched = false;
if r.boost_weight > 0 && ctx.accounts.config.dist_epoch >= r.boost_end_epoch {
    expire_boost(&mut ctx.accounts.config, &mut r)?;
    touched = true;
}
let pending = owed_of(&r, acc)?;
let pay = (pending / ACC_SCALE) as u64;
if pay == 0 { if touched { store_record(ri, &r)?; } continue; }
```

So if boost is due, expire_boost. Then compute pending (with the new weight, no boost). Then compute pay.

After expire_boost: weight = level_weight. So pending = level_weight * acc + carry - debt.

But wait, what's carry at this point?

expire_boost calls unschedule_boost (decrementing ring/boosts_due) and reweigh(c, r, 0).

reweigh:
- before = level_weight + extra.
- owed = owed_of(r, c.acc_scaled) = (level_weight + extra) * acc + carry_old - debt_old.
- boost_weight = 0.
- after = level_weight.
- carry = owed (preserved).
- debt = (level_weight) * acc.

So after reweigh:
- weight = level_weight.
- carry = old pending.
- new debt = level_weight * acc.

pending = level_weight * new * acc + carry - debt = level_weight * acc + old_pending - level_weight * acc = old_pending.

So pending = old_pending. The pay amount is based on old_pending.

Hmm OK so the expire/withdraw flow preserves the pending.

Hmm OK let me look at potential issues with the rerollment.

Now let me think about a potential issue: the rent exemption for the destination ATAs in a redemption.

If a vault's destination ATA is not rent-exempt (e.g., has 0 balance but exists), SPL Token would allow it but might not transfer correctly.

Actually no, the destination ATA can have any balance. The issue would be if the destination doesn't exist (no ATA created).

For SPL Token TransferChecked, if the destination doesn't exist, it fails.

For the sweep helper's destination (the redeemer), the destination must exist. The redeem page is supposed to create it in a prior transaction.

OK that's a client obligation.

Let me look at another potential issue: the v0 size of redemptions.

Per S8.0, the redemption fits within 1232 - 148 = 1084 bytes (with compute budget and separate payer). With all three reserve ATA creates: 1219 bytes. Fits.

For a redemption WITHOUT compute-budget instructions: 1,061 bytes. Fits.

For a redemption with a crank: more bytes. The crank adds at most 4 records * (~80 bytes) = 320 bytes. So 1,061 + 320 = 1,381 bytes. Exceeds 1232!

Hmm so a redemption with the full crank of 4 captures exceeds the legacy packet.

But the redeem page is supposed to send no crank. So this should be fine.

But the suite test 9.14b measures "if the redeemer creates their destination ATAs in the same transaction (three)": 2 mints fit. 3 mints don't fit.

So the redeem page must use prior transaction for ATAs and current transaction for the redemption.

The redeem page must also send NO crank.

Hmm OK so this is documented and tested.

Now let me look at one more potential issue. Let me look at the GUARDIAN.

The guardian is set at initialize. There's no SET_GUARDIAN instruction (deleted in v6). The guardian is permanent.

But the guardian can be replaced via a vote:
- propose arm_guardian.
- after 7 days notice, apply_guardian.

After apply, the new guardian takes office. The old guardian loses power.

For capture:
- emergency_stop_sales, emergency_stop_sweep, cancel_swap_operator (these are stop actions only).

The guardian has NO power to start anything, only stop.

OK.

But the guardian is ALSO the INIT_AUTHORITY. So Gary's wallet signs the one-time initialize.

After initialize, the guardian loses the INIT_AUTHORITY power (no instruction is gated on it except initialize).

OK.

Now let me look at one more potential issue. The `wrap` test (the test-only CPI wrapper) is used to attack the redemption path. Let me check the wrapper code.

```rust
fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (target, rest) = accounts.split_first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let signed = data.starts_with(b"PDASIGN!");
    let padded = data.starts_with(b"PADTAIL!");
    let forwarded = if padded {
        if data.len() < 10 { return Err(ProgramError::InvalidInstructionData); }
        let extra = u16::from_le_bytes([data[8], data[9]]) as usize;
        let mut bytes = data[10..].to_vec();
        let len = bytes.len().checked_add(extra).ok_or(ProgramError::InvalidInstructionData)?;
        if len > 10_240 { return Err(ProgramError::InvalidInstructionData); }
        bytes.resize(len, b'x');
        bytes
    } else if signed { data[8..].to_vec() } else { data.to_vec() };
    let (owner, bump) = Pubkey::find_program_address(&[b"owner"], program_id);
    let metas = rest.iter().map(|a| AccountMeta { pubkey: *a.key,
        is_signer: a.is_signer || (signed && *a.key == owner), is_writable: a.is_writable }).collect();
    let ix = Instruction { program_id: *target.key, accounts: metas,
        data: forwarded };
    if signed { invoke_signed(&ix, rest, &[&[b"owner", &[bump]]]) } else { invoke(&ix, rest) }
}
```

So:
- target: first account (the program to forward to).
- rest: remaining accounts.
- PDASIGN! prefix: forward as if the owner PDA has signed (signer upgrade).
- PADTAIL! prefix: pad with N 'x' bytes.

So PDASIGN! allows the wrapper to sign as the owner PDA.

The test PDASIGN! is used to forward an instruction where the OWNER PDA has signed (via CPI).

For example, `claim_charter_vault` requires the owner to sign. With PDASIGN!, the wrapper can sign as the owner PDA. So `claim_charter_vault` can be called via the wrapper with the owner PDA signed.

But the wrapper is a TEST-ONLY program. It wouldn't exist on mainnet.

OK so the wrapper is used in tests to verify that the programs refuse CPI-wrapped attacks.

The tests WR.1-WR.4 verify this.

OK so the wrapper is fine.

Let me now check one more thing. The "owner PDA" for the wrapper - what is it?

```rust
let (owner, bump) = Pubkey::find_program_address(&[b"owner"], program_id);
```

So `owner` PDA is derived from the wrapper program id and seed "owner". It's a PDA owned by the wrapper.

So the owner PDA is owned by the wrapper program. The wrapper signs on its behalf.

OK.

Now let me think about another potential issue. Let me look at the V1 transaction format.

The prompt mentions:
> **Transaction-format boundary (validation, 2026-10-06).** The packet sizes and default-budget figures above certify the stated legacy shapes; S9b separately exercises v0. ... Solana v1 is active, allows 4,096 bytes and 64 inline accounts, and requires explicit compute-unit and loaded-account-data limits in its message configuration. ComputeBudget instructions do not configure v1. A future v1 client must set those fields and measure its own execution; none of these tests certifies a CBOB v1 transaction.

So v1 transactions need different config. The program tests use legacy and v0 only. v1 is not tested.

Hmm so v1 transactions could behave differently. But the program logic doesn't depend on the transaction format, just on the instructions.

So v1 transactions should work the same as legacy/v0 from the program's perspective.

But the redeem page would need to measure its v1 execution. OK that's documented.

Let me think about another potential issue. Let me look at how the redeem page is supposed to close all reserve accounts.

The sweep helper closes the source account (CLOSE_ACCOUNT). So each reserve account the helper sweeps is closed.

So if the redeem page names all 3 reserve accounts, all 3 are closed. Rent to dest.

But if the redeem page names 0 or 1 or 2 reserve accounts, the others remain open. The unclosed accounts have rent on chain.

OK so the redeem page must name all 3 reserve accounts in the sweep helper call.

OK.

Now let me look at one more potential issue. The freeze authority of cbBTC.

cbBTC accounts can be frozen. If a vault's cbBTC account is frozen:
- claim defers (logs CBOB_CLAIM_DEFERRED_FROZEN).
- The vault cannot be opened (BURN requires empty).

So a frozen vault's cbBTC account is frozen = unredeemable forever.

The owner can transfer the asset (which transfers the frozen cbBTC account too).

Or thaw the cbBTC account.

OK so the freeze authority is real.

Hmm OK let me move on.

Let me look at one more thing. Let me look at the boost's claim nesting.

If a vault has a boost and is transferred to a new owner, the new owner can boost (if boost_weight == 0 and not yet boosted in the new ownership).

But what if the OLD owner boosted and then transferred? The new owner gets a vault with boost already active. The new owner cannot boost again.

Hmm OK.

But the BOOST_ACTIVE check ensures only one boost per vault at a time.

OK.

Let me look at one more potential issue. The "r.boost_weight == 0" check in boost_vault.

```rust
require!(r.boost_weight == 0, MintError::BoostActive);
```

So a vault can be boosted only once. After expiry, r.boost_weight becomes 0. So a new boost can be bought.

But what if expire_boost was called but boost_weight wasn't reset? Let me check.

expire_boost:
```rust
fn expire_boost(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    require!(r.boost_weight > 0 && c.dist_epoch >= r.boost_end_epoch, MintError::BoostNotDue);
    let extra = r.boost_weight;
    unschedule_boost(c, r)?;
    reweigh(c, r, 0)?;
    r.boost_end_epoch = 0;
    msg!("CBOB_BOOST_EXPIRED asset={} weight={}", r.asset, extra);
    emit!(BoostExpired { asset: r.asset, extra_weight: extra, epoch: c.dist_epoch,
        total_weight: c.total_active_weight });
    Ok(())
}
```

So expire_boost calls reweigh(c, r, 0). reweigh:
```rust
fn reweigh(c: &mut MintConfig, r: &mut VaultRecord, boost: u8) -> Result<()> {
    require!(r.active, MintError::BoostNeedsActiveVault);
    let before = weight_of(r)?;
    let owed = owed_of(r, c.acc_scaled)?;
    r.boost_weight = boost;
    let after = weight_of(r)?;
    r.carry_scaled = owed;
    r.debt_scaled = (after as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
    c.total_active_weight = c.total_active_weight.checked_sub(before).ok_or(MintError::Overflow)?
        .checked_add(after).ok_or(MintError::Overflow)?;
    Ok(())
}
```

So reweigh sets r.boost_weight = boost. With boost = 0, r.boost_weight = 0.

So after expire_boost, r.boost_weight = 0.

OK good.

But wait, the next call to expire_boost would require r.boost_weight > 0. Since r.boost_weight = 0, BoostNotDue is returned.

So expire_boost can't be called twice. Good.

But what if there's a race condition? E.g., expire_boost is called, then reweigh runs, then expire_boost is called again. The second call would fail (boost_weight = 0).

But Anchor's instruction processing is sequential. So the second call would see the updated state (boost_weight = 0) and fail.

OK.

Hmm let me think about a potential issue with the boost expiry in retire.

retire:
```rust
if r.boost_weight > 0 { unschedule_boost(c, r)?; }
```

So if a vault has a boost, unschedule_boost is called. unschedule_boost decrements ring/boosts_due.

OK.

But wait, what if the boost was due but not yet expired (not yet expire_boost'd)? Then unschedule_boost's `c.dist_epoch >= r.boost_end_epoch` check is true. Decrement boosts_due.

Hmm so if the vault is retired while the boost is due (in boosts_due), the boost's count is moved from boosts_due to 0.

OK.

But what if the boost was NOT due? Then unschedule_boost's check is false. Decrement ring[(end) % 64].

Hmm OK.

But what about the boost's weight? After unschedule_boost, r.boost_weight is still > 0 (unschedule_boost doesn't change r.boost_weight).

But retire sets r.active = false. So weight_of(r) would fail (require!(r.level, ...)).

Hmm so after retire, r is not active. Future operations on r would fail.

OK.

But wait, retire doesn't reset r.boost_weight. So if retire is called on a vault with a boost, r.boost_weight stays > 0 but r.active = false.

This is consistent: retired vaults are inert. r.boost_weight is just history.

OK.

But there's a subtle issue: the boost's contribution to total_active_weight was already removed by retire. Hmm actually no, let me re-read retire.

```rust
if r.active {
    let w = weight_of(r)?;
    ...
    c.total_active_weight = c.total_active_weight.checked_sub(w).ok_or(MintError::Overflow)?;
    ...
    if r.boost_weight > 0 { unschedule_boost(c, r)?; }
    ...
}
```

So if r.active (before retire), w is the boosted weight (since r.boost_weight > 0). Then total_active_weight -= w (decreased by boosted weight).

Then unschedule_boost(c, r) decrements ring/boosts_due.

So the boost's contribution to total_active_weight is removed (via the w subtraction). And the boost's count in ring/boosts_due is removed (via unschedule_boost).

OK consistent.

Now let me think about one more potential issue: the BOOST_DATE/W window.

Boost purchases are bound by `BoostTermsMoved`. The buyer signs max_price, min_weight, min_epochs. If the voted terms are worse, refused.

But what if the voted terms are BETTER (lower price, more weight, more epochs)? Then the boost is bought at the NEW (better) terms.

This is the "one-sided" rule per round 23.

What if max_price > new_price? Buyer agreed to pay up to max_price. New price is lower. Buyer is happy.

What if min_weight > new_weight? Buyer wanted at least min_weight. New weight is higher (more). Buyer is happy.

What if min_epochs > new_epochs? Buyer wanted at least min_epochs. New epochs is longer. Buyer is happy.

So the boost is bought at the new (better) terms.

But what if min_weight > new_weight AND min_epochs > new_epochs? Then both conditions satisfied. Boost bought.

Hmm so the test BO.30a says: "the same vote LOWERED the price: signed at the old (higher) ceiling, the boost lands and burns the NEW price".

For my interpretation: the boost is bought with the new (lower) price. The buyer paid less.

OK.

Now let me think about another potential issue. Let me look at the `set_boost_terms` execution:

```rust
ProposalAction::SetBoostTerms { price, weight, epochs } => {
    if id <= cfg.last_boost_id { skipped(id, "set_boost_terms", "superseded"); continue; }
    cfg.last_boost_id = id;
    let mut d = IX_SET_BOOST_TERMS.to_vec();
    d.extend_from_slice(&price.to_le_bytes());
    d.push(*weight);
    d.extend_from_slice(&epochs.to_le_bytes());
    calls.push(d);
}
```

So no VALIDATE check before CPI. Just calls MINT's set_boost_terms.

MINT's set_boost_terms:
```rust
pub fn set_boost_terms(ctx: Context<Governed>, price: u64, weight: u8, epochs: u16) -> Result<()> {
    let c = &mut ctx.accounts.config;
    if price > 0 {
        require!(weight >= 1 && weight <= c.max_boost_weight, MintError::BoostTermsOutOfBounds);
        require!(epochs >= 1 && epochs <= c.max_boost_epochs, MintError::BoostTermsOutOfBounds);
    }
    c.boost_price = price;
    c.boost_weight = if price > 0 { weight } else { 0 };
    c.boost_epochs = if price > 0 { epochs } else { 0 };
    emit!(BoostTermsSet { price, weight: c.boost_weight, epochs: c.boost_epochs });
    Ok(())
}
```

So:
- If price > 0: weight and epochs must be in [1, max].
- c.boost_weight = weight (if price > 0) else 0.
- c.boost_epochs = epochs (if price > 0) else 0.

If price = 0, boosts are OFF.

OK.

Now let me think about a potential issue with the boost off case. If price = 0, boosts are off. The boost_weight and boost_epochs are set to 0.

If a vault already has an active boost when price is set to 0, what happens?

The vault's boost_weight is unchanged. It still gets the boost at the previous terms. The new price (0) only affects new boost purchases.

Hmm so setting price = 0 doesn't expire existing boosts. They're still active until their natural expiry.

OK.

But the spec says: "Price has no launch ceiling, and 0 turns boosts off again; a boost already bought keeps its terms."

So this is documented.

OK.

Now let me look at one more potential issue. Let me look at the boost's expiry via vote.

A vote can set boost terms. But can a vote cancel a boost? No, there's no "cancel boost" instruction.

So boosts are exempt from votes. Once bought, they run their course.

OK.

Now let me think about another potential issue. Let me look at the redeem_charter_vault carefully.

```rust
pub fn claim_charter_vault<'info>(ctx: Context<'_, '_, '_, 'info, ClaimCharterVault<'info>>, name: String, uri: String,
                           attributes: Vec<VaultAttribute>, pob_proof: Vec<[u8; 32]>, pob_extra: u8) -> Result<()> {
    let n_extra = pob_extra as usize;
    require!(n_extra <= MAX_POB_EXTRA && n_extra <= ctx.remaining_accounts.len(), MintError::BadPobExtra);
    let (extra, crank_accts) = ctx.remaining_accounts.split_at(n_extra);
    { let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
      monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)?; }
    let cfg = &ctx.accounts.config;
    let now = Clock::get()?.unix_timestamp;
    require!(now >= cfg.charter_opens_at, MintError::CharterNotOpen);
    require!(now < cfg.charter_closes_at, MintError::CharterClosed);
    check_supply(cfg)?;
    check_attributes(&attributes, MAX_ATTRS - 2)?;
```

So the charter check is `now >= opens_at && now < closes_at`. So at exactly opens_at, it's open. At exactly closes_at, it's closed.

Hmm so the window is `[opens_at, closes_at)`.

If the charter window is 7 days = 604800 seconds. Then the window is exactly 604800 seconds long.

OK.

But what about the `let now = Clock::get()?.unix_timestamp;` call? It's called twice. The first call is for monthly_inline. The second is for the charter check. These are different times (might differ by a second or so).

Hmm so the second `now` could be slightly different from the first.

For monthly_inline: uses first `now`.
For charter check: uses second `now`.

OK these are independent.

Hmm but actually wait, the second `now` is after the PoB checks (which I haven't read yet). Let me re-look.

Actually the code has:
```rust
{ let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
  monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)?; }
let cfg = &ctx.accounts.config;
let now = Clock::get()?.unix_timestamp;
require!(now >= cfg.charter_opens_at, MintError::CharterNotOpen);
require!(now < cfg.charter_closes_at, MintError::CharterClosed);
```

So monthly_inline uses first now. Charter check uses second now.

But the second now is AFTER monthly_inline. So if monthly_inline took a while (e.g., for many accounts), the second now could be later.

But for the charter check, this doesn't matter (charter opens_at and closes_at are well in the past or future).

OK.

Hmm wait but what if monthly_inline calls clock and the second now is computed AFTER all the monthly_inline logic? Yes that's the case.

So the second `now` could be a second or so after the first. Doesn't matter for charter check.

OK.

Let me look at another potential issue. The PoB check.

```rust
let cfg = &ctx.accounts.config;
let now = Clock::get()?.unix_timestamp;
require!(now >= cfg.charter_opens_at, MintError::CharterNotOpen);
require!(now < cfg.charter_closes_at, MintError::CharterClosed);
check_supply(cfg)?;
check_attributes(&attributes, MAX_ATTRS - 2)?;
```

So check_supply is called BEFORE the PoB check. So supply is checked.

But the supply check uses cfg which was read BEFORE. If monthly_inline changed anything... hmm but monthly_inline doesn't change minted_total or level_minted. So supply check is the same.

Wait, what about charter_claimed? Does monthly_inline modify it? Let me check.

monthly_inline calls credit or tick. credit modifies total_active_weight, owed_scaled, etc. tick modifies dist_epoch, pending_this_epoch, etc.

None modifies minted_total, level_minted, charter_claimed.

So check_supply uses the current state.

OK.

Let me look at the PoB check:
```rust
let pob = ctx.accounts.pob_asset.key();
{
    let a = &ctx.accounts.pob_asset;
    require_keys_eq!(*a.owner, MPL_CORE_ID, MintError::NotAProofOfBurn);
    let d = a.try_borrow_data()?;
    require!(d.len() >= 66 && d[0] == KEY_ASSET_V1, MintError::NotAProofOfBurn);
    let mut o = [0u8; 32]; o.copy_from_slice(&d[1..33]);
    require_keys_eq!(Pubkey::new_from_array(o), ctx.accounts.owner.key(), MintError::NotThePobOwner);
    require!(d[33] == UA_DISC_COLLECTION, MintError::NotAProofOfBurn);
    let mut c = [0u8; 32]; c.copy_from_slice(&d[34..66]);
    require_keys_eq!(Pubkey::new_from_array(c), cfg.pob_collection, MintError::NotAProofOfBurn);
}
require_keys_eq!(ctx.accounts.pob_collection.key(), cfg.pob_collection, MintError::NotAProofOfBurn);
require!(pob_proof.len() <= MAX_POB_PROOF, MintError::PobProofTooLong);
require!(merkle_root_from(merkle_leaf(&pob), &pob_proof) == cfg.pob_root, MintError::NotInPobSet);
```

So PoB checks:
1. PoB asset owner is Core.
2. PoB asset is AssetV1.
3. PoB asset owner matches signer.
4. PoB asset collection_disc is collection_disc (asset is in collection).
5. PoB asset collection matches config's collection.
6. The pob_collection account matches config's.
7. Proof length <= 16.
8. Merkle proof valid.

OK.

But what about PoB asset's `update_authority_disc`? Should be 2 (UA_DISC_COLLECTION).

The check `d[33] == UA_DISC_COLLECTION` ensures this.

OK.

Now let me think about another potential issue. The PoB set.

The PoB set is 240 assets. The root is built from these 240 asset addresses.

But what if a PoB is released multiple times? The Merkle proof would be different (proofs are unique).

But once a PoB is burned, the same asset can't be used again (the address can't be re-minted as a Core asset).

So each PoB can be burned at most once. The 240 Pobs can be burned at most 240 times. After 240 burns, no more charter claims.

OK.

But the charter window is 7 days. After the window, no more claims. So the maximum number of charter claims is 240.

If more than 240 holders want charters (rarer than possible), 240 get vaults and the rest don't.

OK.

Let me look at one more potential issue. Let me look at the BoostsExpireFirst check:

```rust
require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst);
```

This is at the start of distribute (before checking weight).

So even if w == 0, if boosts_due > 0, distribute refuses.

But wait, the w == 0 case is handled separately:
```rust
if w == 0 {
    let c = &mut ctx.accounts.config;
    require!(waiting_to_join(c)? == 0, MintError::JoinWaitingFirst);
    require!(!burn && c.pending_this_epoch > 0, MintError::NoActiveVaults);
    require!(ctx.remaining_accounts.is_empty(), MintError::BadBurnAccounts);
    require!(now >= c.last_distribute_at.checked_add(c.monthly_secs).ok_or(MintError::Overflow)?,
        MintError::MonthNotElapsed);
    return tick(c, now);
}
```

But BoostsExpireFirst is checked BEFORE this. So if boosts_due > 0 and w == 0, refused.

But w == 0 means no active weight. Could boosts_due be > 0? Yes, if a vault was boosted, retired (bare-burned), and the boost wasn't unscheduled.

Wait, retire calls unschedule_boost if boost_weight > 0. So retired vaults should not contribute to boosts_due.

Hmm but the boost could be in due if the boost's epoch passed but the vault wasn't retired. Then distribute's BoostsExpireFirst fires and refuses.

So distribute is refused until the boost is expired.

But w == 0 means no active vaults. If no boosted vaults, then... hmm wait, the boost can be on an active vault. If the active vault's boost is due, BoostsExpireFirst fires.

If w == 0 AND there's a boost due: that's weird. The boosted vault must be active. So w > 0.

So BoostsExpireFirst is more relevant when w > 0.

But the check is done regardless of w. So a distribute with w == 0 and boosts_due > 0 is refused.

But this combination is unlikely. Hmm but the code checks it anyway.

OK.

Actually let me re-read distribute:

```rust
pub fn distribute<'info>(...) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool_owner = ctx.accounts.config.key();
    {
        let c = &ctx.accounts.config;
        require_keys_eq!(ctx.accounts.pool_token.key(), c.pool_ata, MintError::WrongPool);
    }
    let (balance, _) = read_token(&ctx.accounts.pool_token, &ctx.accounts.config.payment_mint, &pool_owner)?;
    // Before anything, and before any $GARY is burned: a DUE boost is expired first (free, `claim`), so it never earns past the distributions it bought.
    require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst);
    let w = ctx.accounts.config.total_active_weight;
    ...
}
```

So distribute:
1. Check pool account.
2. Read pool balance.
3. Check boosts_due == 0. (BEFORE any other work.)
4. Then proceed with weight checks.

So BoostsExpireFirst is the gate. If boosts_due > 0, refuse. Otherwise proceed.

OK.

Now let me think about another potential issue. Let me look at the boost_expiring ring more carefully.

The ring is of size 64. Each slot is u32. So at most u32::MAX boosts can be stored per slot.

In practice, at most 2100 vaults, so at most 2.1k boosts. Per slot, probably at most a few hundred.

But u32 allows for 4 billion. Plenty.

The check in unschedule_boost:
```rust
c.boost_expiring[i] = c.boost_expiring[i].checked_sub(1).ok_or(MintError::Overflow)?;
```

So decrementing can overflow if the slot is 0. But the boost was added when slot was at least 1. The decrement is valid.

But what if the same boost is double-decremented? E.g., expire_boost is called twice. The second call's decrement would underflow.

But expire_boost requires r.boost_weight > 0. After first expire_boost, r.boost_weight = 0. Second call fails.

So no double-decrement.

OK.

Hmm let me think about one more potential issue. Let me look at the boost's expiry via claim and expire_boosts.

claim:
```rust
if r.boost_weight > 0 && ctx.accounts.config.dist_epoch >= r.boost_end_epoch {
    expire_boost(&mut ctx.accounts.config, &mut r)?;
    touched = true;
}
```

So claim can expire a boost.

expire_boosts (instruction):
```rust
if r.retired || !r.active || r.boost_weight == 0 || ctx.accounts.config.dist_epoch < r.boost_end_epoch {
    continue;
}
expire_boost(&mut ctx.accounts.config, &mut r)?;
```

So expire_boosts can expire boosts.

But what if claim and expire_boosts are both called on the same boost? E.g., a tx that calls claim on vault X (expire boost) and then calls expire_boosts on vault X again.

claim expires the boost. r.boost_weight = 0.

expire_boosts check: r.boost_weight == 0, so continue (skip).

So no double-expire. Good.

OK.

Now let me look at one more potential issue. Let me look at the redistribute.

Actually wait, redistribute doesn't exist. The distribute is called once per period (or burn). Not multiple times.

So no redistribute issue.

OK.

Let me look at another potential issue. The SET_ROUND call.

```rust
pub fn set_round(
    ctx: Context<Governed>,
    opens_at: i64,
    closes_at: i64,
    price: u64,
    cap: u32,
) -> Result<()> {
    require!(closes_at > opens_at, MintError::BadWindow);
    require!(closes_at.checked_sub(opens_at).ok_or(MintError::BadWindow)? <= MAX_ROUND_SECS,
        MintError::BadWindow);
    require!(cap > 0, MintError::BadCap);
    require!(price >= MIN_ROUND_PRICE_SATS, MintError::PriceBelowFloor);
    let c = &mut ctx.accounts.config;
    c.round_id = c.round_id.checked_add(1).ok_or(MintError::Overflow)?;
    c.opens_at = opens_at;
    c.closes_at = closes_at;
    c.price = price;
    c.cap = cap;
    c.minted_this_round = 0;
    emit!(RoundSet { round_id: c.round_id, opens_at, closes_at, price, cap });
    Ok(())
}
```

So SET_ROUND:
- closes_at > opens_at.
- window <= MAX_ROUND_SECS (1 year).
- cap > 0.
- price >= MIN_ROUND_PRICE_SATS (21,000 sats).

If all checks pass, increments round_id and sets the round params.

OK.

Hmm let me think about an issue with the GOV's execute_proposal.

```rust
ProposalAction::SetRound { opens_at, closes_at, price, cap } => {
    if id <= cfg.last_round_id { skipped(id, "set_round", "superseded"); continue; }
    cfg.last_round_id = id;
    if *closes_at <= now { skipped(id, "set_round", "round_already_over"); continue; }
    let mut d = IX_SET_ROUND.to_vec();
    d.extend_from_slice(&opens_at.to_le_bytes());
    d.extend_from_slice(&closes_at.to_le_bytes());
    d.extend_from_slice(&price.to_le_bytes());
    d.extend_from_slice(&cap.to_le_bytes());
    calls.push(d);
}
```

So GOV's execute_proposal checks the round is not over.

But the `SetRound` action is also validated at create_proposal:
```rust
ProposalAction::SetRound { opens_at, closes_at, cap, price } => {
    require!(*price >= MIN_ROUND_PRICE_SATS, GovError::PriceBelowFloor);
    require!(closes_at > opens_at, GovError::BadWindow);
    require!(closes_at.checked_sub(*opens_at).ok_or(GovError::BadWindow)? <= MAX_ROUND_SECS,
        GovError::BadWindow);
    require!(*cap > 0, GovError::BadWindow);
}
```

So at create, window > opens_at and window <= 1 year. cap > 0. price >= floor.

At execute, the round must not be over.

So the round can be created with a future window, but if execution happens after closes_at, it's not installed.

OK.

Now let me think about one more potential issue. Let me look at the round_id overflow.

round_id is u32. Incremented at each set_round.

For 2100 vaults, at most 2100 / cap = some number of rounds.

For cap = 100, 21 rounds. round_id max = 21. No overflow.

For cap = 1, 2100 rounds. round_id max = 2100. No overflow.

For cap = 0... wait cap > 0 is checked. So min cap = 1.

2100 rounds. No overflow.

OK.

Now let me look at one more potential issue. The charter_window in the SPEC.

"Charter window: 7 days; the dates are not yet set."

So charter_opens_at and charter_closes_at are determined later.

At initialize, charter_opens_at and charter_closes_at are passed.

`require!(charter_closes_at > charter_opens_at, MintError::BadCharterWindow);`
`require!(charter_closes_at.checked_sub(charter_opens_at).ok_or(MintError::BadCharterWindow)? <= MAX_CHARTER_SECS, MintError::BadCharterWindow);` (90 days max)
`require!(charter_closes_at > Clock::get()?.unix_timestamp, MintError::BadCharterWindow);` (window not over at init).

So charter window must be in the future, opens_at < closes_at, <= 90 days.

OK.

Now let me look at one more potential issue. Let me look at the BURN's call to MINT.

```rust
invoke(&Instruction {
    program_id: MINT_PROGRAM_ID,
    accounts: vec![
        AccountMeta::new(ctx.accounts.mint_config.key(), false),
        AccountMeta::new(ctx.accounts.vault_record.key(), false),
        AccountMeta::new_readonly(ctx.accounts.vault_asset.key(), false),
        AccountMeta::new_readonly(ctx.accounts.instructions.key(), false),
        AccountMeta::new_readonly(ctx.accounts.pool_token.key(), false),
    ],
    data: IX_RETIRE_REDEEMED_DISC.to_vec(),
}, &[...])?;
```

So BURN calls MINT's retire_redeemed with 5 accounts (not signing as GOV).

In MINT's retire_redeemed:
```rust
pub fn retire_redeemed(ctx: Context<RetireRedeemed>) -> Result<()> {
    require!(get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1, MintError::NotFromBurn);
    ...
}
```

So MINT checks that this is called via CPI (stack height 1 above top-level).

```rust
pub struct RetireRedeemed<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: the vault being burned; must equal vault_record.asset and be burned.
    pub asset: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar — proves the caller is BURN's burn_vault.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    /// CHECK: the pool (config.pool_ata), read for the monthly in-line run.
    pub pool_token: UncheckedAccount<'info>,
}
```

So MINT's RetireRedeemed has:
- 0: config
- 1: vault_record
- 2: asset
- 3: instructions
- 4: pool_token

And BURN's call has:
- 0: mint_config (= config)
- 1: vault_record
- 2: vault_asset
- 3: instructions
- 4: pool_token

So they match. ✓

In MINT:
```rust
{
    let sysvar = ctx.accounts.instructions.to_account_info();
    let cur = load_current_index_checked(&sysvar)? as usize;
    let ix = load_instruction_at_checked(cur, &sysvar)?;
    require!(ix.program_id == BURN_PROGRAM_ID
        && ix.data.len() >= IX_BURN_VAULT_DISC.len()
        && ix.data[..IX_BURN_VAULT_DISC.len()] == IX_BURN_VAULT_DISC
        && ix.accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(ctx.accounts.asset.key()),
        MintError::NotFromBurn);
}
require_keys_eq!(ctx.accounts.asset.key(), ctx.accounts.vault_record.asset, MintError::WrongAsset);
require!(is_burned(&ctx.accounts.asset)?, MintError::NotBurned);
let forfeit = pool_is_frozen(&ctx.accounts.pool_token, &ctx.accounts.config)?;
retire(&mut ctx.accounts.config, &mut ctx.accounts.vault_record, true, forfeit)?;
let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)
}
```

So retire_redeemed:
1. Stack height check.
2. Current instruction is BURN's burn_vault for this asset.
3. Asset matches vault_record.
4. Asset is burned.
5. Compute forfeit (pool frozen?).
6. Retire.
7. monthly_inline.

OK.

Hmm wait, the BURN_IX_ASSET_IDX check: `ix.accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(ctx.accounts.asset.key())`.

BURN_IX_ASSET_IDX = 0 (defined in MINT). So ix.accounts[0] is checked against asset.

In BURN's burn_vault:
```rust
data: vec![IX_BURN_VAULT_DISC.to_vec(),]
accounts: vec![
    AccountMeta::new(ctx.accounts.vault_asset.key(), false),  // 0
    AccountMeta::new(ctx.accounts.collection.key(), false),  // 1
    AccountMeta::new_readonly(ctx.accounts.owner.key(), true),  // 2
    AccountMeta::new(ctx.accounts.asset_signer.key(), false),  // 3
    ...
],
```

Wait actually let me look at the burn_vault instruction definition in