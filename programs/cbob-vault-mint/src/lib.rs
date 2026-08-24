//! CBOB Vault MINT — the only way a vault is created, and the only thing the
//! governors can steer.
//!
//! GOVERNANCE SCOPE IS DELIBERATELY TINY: a ratified vote sets **when** a round
//! opens and **what it costs**. That is the whole parameter space. A hostile
//! majority cannot express a dangerous proposal because the instruction has
//! nowhere to put one — no plugin set, no seal, no redemption rule. And existing
//! vaults are untouchable regardless: permanent plugins are create-only, so no
//! vote can ever reach backwards into a vault already minted.
//!
//! The plugin set below is HARDCODED and ungovernable. That is the point.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    system_instruction,
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
    sysvar::slot_hashes,
    hash::hashv,
};

declare_id!("Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo");

/// ═══ THE COMMITTED DECK ═══
///
/// The quota below makes "no more than twelve Level V will ever exist" an
/// on-chain invariant. It does NOT stop the Bank handing all twelve to its
/// friends — caps bound the SUPPLY of a level, never its ALLOCATION. Without
/// something more, the Bank both asserts a level and certifies it, which is the
/// one arrangement this project refuses everywhere else.
///
/// So the deck is shuffled OFF-CHAIN from a seed neither side can pre-compute
/// (`H(bank_salt || blockhash(future slot X))`, with `H(bank_salt)` published
/// before minting opens), committed here as a Merkle root, and every mint must
/// present a proof that the deck really does assign THIS level to THIS index.
///
/// ⚠️ THE INDEX IS `minted_total`, WHICH THE PROGRAM OWNS. That is the whole
/// reason this cannot be ground. A minter submits the transaction and chooses
/// the asset keypair, so anything derived from data they control can be
/// simulated and retried until it lands on V. They cannot choose which mint
/// number they are.
///
/// Leaf and node are domain-separated (0x00 / 0x01) so a 64-byte leaf can never
/// be replayed as an internal node — the classic second-preimage attack on a
/// Merkle tree that hashes both the same way. Pairs are SORTED, so a proof
/// carries no direction bits and cannot be re-ordered into a different root.
const DECK_LEAF_TAG: u8 = 0x00;
const DECK_NODE_TAG: u8 = 0x01;
/// 2,100 vaults is depth 12; 240 is depth 8. A bound at all, because an
/// unbounded proof is unbounded compute and unbounded bytes.
const MAX_DECK_PROOF: usize = 24;

/// The blockhash of one slot, read out of the SlotHashes sysvar.
///
/// ⚠️ PIN THE ACCOUNT, PARSE DEFENSIVELY, AND FAIL CLOSED. This is a raw-offset
/// read of an account this program does not own — the same shape as the config
/// reads that round 12 built `bank/anchor.mjs` for, and the same discipline
/// applies. The key is checked against the sysvar id, the declared count is
/// bounded by the sysvar's own documented maximum, the buffer is checked to hold
/// what the count claims, and an all-zero hash is refused rather than being fed
/// into a seed as if it were entropy.
///
/// Layout: `u64 count`, then `count` entries of `(u64 slot, [u8; 32] hash)`,
/// ordered newest first.
fn blockhash_of_slot(acct: &UncheckedAccount, want: u64) -> Result<[u8; 32]> {
    require_keys_eq!(acct.key(), slot_hashes::ID, MintError::BadSlotHashes);
    let data = acct.try_borrow_data()?;
    require!(data.len() >= 8, MintError::BadSlotHashes);
    let n = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
    require!(n <= SLOT_HASHES_MAX, MintError::BadSlotHashes);
    require!(data.len() >= 8 + n * 40, MintError::BadSlotHashes);
    for i in 0..n {
        let off = 8 + i * 40;
        if u64::from_le_bytes(data[off..off + 8].try_into().unwrap()) == want {
            let mut h = [0u8; 32];
            h.copy_from_slice(&data[off + 8..off + 40]);
            require!(h != [0u8; 32], MintError::BadSlotHashes);
            return Ok(h);
        }
    }
    err!(MintError::DeckSlotUnavailable)
}

fn deck_leaf(index: u32, level: u8) -> [u8; 32] {
    hashv(&[&[DECK_LEAF_TAG], &index.to_le_bytes(), &[level]]).to_bytes()
}

fn deck_root_from(mut node: [u8; 32], proof: &[[u8; 32]]) -> [u8; 32] {
    for sib in proof.iter() {
        node = if node <= *sib {
            hashv(&[&[DECK_NODE_TAG], &node, sib]).to_bytes()
        } else {
            hashv(&[&[DECK_NODE_TAG], sib, &node]).to_bytes()
        };
    }
    node
}

/// OUR OWN `mint_vault` discriminator, for the Bank-key confinement below. Same
/// shape as SEAL's constant and asserted against `sha256("global:mint_vault")`
/// in the suite, not copied from anywhere.
pub const IX_MINT_VAULT_DISC: [u8; 8] = [29, 76, 246, 26, 123, 202, 230, 234];
/// The ONLY account position in `mint_vault` where the Bank's key legitimately
/// appears. `payer` sits at 5 and PAYS `price_lamports`, so an exemption that
/// waved the whole instruction through let the Bank buy an attacker a vault.
const MINT_IX_BANK_IDX: usize = 4;

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
/// The SEAL PROGRAM. Its `["seal"]` PDA is DERIVED at runtime, never hardcoded —
/// a stale constant would embed a plugin authority the seal program cannot sign,
/// and every vault minted with it would be born permanently frozen with its BTC
/// unreachable by ANY party. Derive it, do not copy it.
pub const SEAL_PROGRAM_ID: Pubkey = pubkey!("9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273");
pub const SEAL_SEED: &[u8] = b"seal";
pub const SEAL_CONFIG_SEED: &[u8] = b"config";
/// The CBOBTC Squads multisig (set 2026-08-22). It is OFF-CURVE — a Squads vault
/// PDA — so it signs by CPI from the Squads program, which is fine for an
/// authority. It can never be a vault OWNER: `mint_vault` requires the owner's
/// direct signature precisely because a PDA-owned vault could never be redeemed.
///
/// ⚠️ THE ONE THING THAT DIFFERS BETWEEN THE TESTED AND SHIPPED BINARY.
/// A Squads vault cannot sign in a local test, so `--features localnet` swaps in
/// a deterministic test key. That is a real (small, acknowledged) gap: the binary
/// the suite exercises is not byte-identical to the one that deploys. It is
/// closed the only way it can be — `scripts/build-mainnet.sh` builds WITHOUT the
/// feature and asserts the compiled .so contains the Squads key and does NOT
/// contain the test key, then prints the sha256 that must be deployed.
#[cfg(not(feature = "localnet"))]
pub const INIT_AUTHORITY: Pubkey = pubkey!("bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1");
#[cfg(feature = "localnet")]
pub const INIT_AUTHORITY: Pubkey = pubkey!("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");

/// ROOM TO ADD A FIELD WITHOUT BRICKING THE PROGRAM.
///
/// Round 11. Fields were appended to these configs in rounds 6, 8 and 10, and
/// `Initialize` allocates EXACTLY the current size with no `realloc` anywhere in
/// any of the four programs. After mainnet init, the next appended field makes
/// every `Account<Config>` deserialize fail — which in MINT means `mint_vault`,
/// `sweep_sol_for_swap` and `split_revenue`, and `split_revenue` is the only
/// instruction that can move cbBTC out of the revenue PDA. Given the observed
/// cadence of appends that is a when, not an if.
///
/// Trailing bytes are ignored by Borsh, so this is free until it is needed and
/// costs about 0.0018 SOL of rent. It is not a migration path — it is the room
/// to write one in.
const CONFIG_PADDING: usize = 112;   // was 256; LEVELS AT MINT spent 72 (caps 20 + minted 20 + root 32),
                                     // ROUND 20's binding commitment spent 72 more
                                     // (salt_hash 32 + slot 8 + seed 32). The ACCOUNT
                                     // SIZE IS UNCHANGED — the padding exists so a
                                     // field can be added without a migration, and
                                     // this is the second time it has paid for itself.
/// How far ahead of `commit_seed` the entropy slot sits.
///
/// ⚠️ THE CALLER DOES NOT CHOOSE THIS, AND THAT IS THE POINT. Round 20's auditors
/// asked for a committed salt and a named future slot. Naming the slot is one more
/// input the Bank controls, and an input the Bank controls is an input the Bank can
/// grind — so the program derives it instead. There is nothing left to choose: the
/// salt is fixed by its hash before this slot exists, and the slot is fixed by
/// arithmetic the caller cannot influence.
///
/// 32 slots is about 13 seconds. It only has to outlast the transaction that
/// commits the salt, because the property required is "this blockhash did not exist
/// when the salt was committed", not "this blockhash is far away".
const DECK_SLOT_LEAD: u64 = 32;
/// SlotHashes holds the most recent 512 slots and nothing older. `commit_deck` must
/// therefore land within 512 slots (~3.4 minutes) of the entropy slot, and MISSING
/// THAT WINDOW IS FATAL BY DESIGN: there is no re-seed instruction, because a Bank
/// that could re-seed by deliberately missing the window would get an unlimited
/// number of draws, which is the grind this whole scheme exists to close. A missed
/// window means minting never opens — loud, total, and not a silent re-roll.
const SLOT_HASHES_MAX: usize = 512;
pub const CONFIG_SEED: &[u8] = b"mint-config";
/// Signs CreateV2 as the collection's update authority, so nothing but this
/// program can put an asset into the CBOB collection.
pub const MINT_SEED: &[u8] = b"mint";
/// THE ONE ON-CHAIN ADDRESS FOR ALL PROJECT INCOME.
///
/// Mint prices, secondary royalties, and anything else the project ever earns are
/// pointed here. It is a PDA of this program, so nobody holds its key: value can
/// only leave through `split_revenue` (the enforced 85/15) or
/// `sweep_sol_for_swap` (bounded, admin-gated, evented).
pub const REVENUE_SEED: &[u8] = b"revenue";
/// SPL Token `TransferChecked`.
const IX_TRANSFER_CHECKED: u8 = 12;
pub const SPL_TOKEN_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const ATA_PROGRAM_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/// SEAL's `Config` layout, PINNED. Anchor disc = sha256("account:Config")[..8],
/// then `version: u8` deliberately declared FIRST so it sits at a fixed offset
/// whatever else is added later. Reading a sibling program's account by raw
/// offset with no discriminator and no version is a silent misread waiting for
/// the next upgrade; this turns it into a loud refusal.
pub const SEAL_CONFIG_DISC: [u8; 8] = [155, 12, 170, 224, 30, 250, 204, 130];
pub const SEAL_CONFIG_VERSION: u8 = 1;
/// This program's own config layout version, read by GOV.
pub const MINT_CONFIG_VERSION: u8 = 1;
pub const MINT_CONFIG_DISC: [u8; 8] = [168, 252, 88, 182, 219, 205, 39, 53];
const OFF_VERSION: usize = 8;
const OFF_ADMIN: usize = 9;
const OFF_COLLECTION: usize = 41;
const OFF_BANK: usize = 73;

const IX_CREATE_V2: u8 = 20;
/// Core instruction indices, read off SDK-built instructions.
const IX_ADD_COLLECTION_PLUGIN_V1: u8 = 3;
const IX_UPDATE_COLLECTION_PLUGIN_V1: u8 = 7;
/// Plugin::Royalties is variant 0.
const PLUGIN_ROYALTIES: u8 = 0;
/// RuleSet::None
const RULESET_NONE: u8 = 0;
/// Basis points of the mint price and of royalties that go to VAULT HOLDERS.
/// The remainder is the Bank's. 8500 = the 85/15 rule.
const DEFAULT_SPLIT_BPS: u16 = 8_500;
const BPS: u64 = 10_000;
const PLUGIN_PERMANENT_FREEZE_EXECUTE: u8 = 17;
const PLUGIN_ATTRIBUTES: u8 = 6;
const PLUGIN_AUTHORITY_ADDRESS: u8 = 3;
const MAX_NAME_LEN: usize = 64;
const MAX_URI_LEN: usize = 200;
/// Provenance stamped at creation. Bounded so the Attributes plugin stays within
/// what SEAL's `mark_opened` is willing to parse and rewrite — if MINT could
/// write more attributes than SEAL can preserve, the first redemption would fail
/// closed and the vault could never be opened.
const MAX_ATTRS: usize = 8;
const MAX_ATTR_STR: usize = 128;
/// SEAL owns this key and rewrites it on every close; MINT must never set it.
const ATTR_REDEMPTION: &str = "redemption";
/// THE PROGRAM OWNS THIS KEY, AND THAT IS THE WHOLE MECHANISM. `attributes` is
/// CALLER-SUPPLIED: without reserving `level` the minter simply types their own,
/// and the lottery is a form field. The Bank co-signs every mint and could refuse
/// such a transaction, but that is off-chain policy, and round 18 settled that
/// policy is a mitigation and never a proof. So the caller may not set it, and
/// MINT appends it from a value the quota gate below has already bounded.
const ATTR_LEVEL: &str = "level";
/// I..V, index 0..4. The wire value is 1..=5 so that a zero — the value an
/// uninitialised or forgotten argument takes — is never a valid level.
const LEVEL_NAMES: [&str; 5] = ["I", "II", "III", "IV", "V"];
/// A round may not run longer than this. `closes_at = i64::MAX` was expressible.
const MAX_ROUND_SECS: i64 = 365 * 24 * 3600;
/// The most this collection may ever charge on a resale. Not a byte bound.
const MAX_ROYALTY_BPS: u16 = 1_000;
/// HOW LONG A GOVERNANCE ROTATION SITS IN PUBLIC BEFORE IT BITES.
///
/// Round 6 found that "rotating the treasury requires the governance signature"
/// was not a control at all. Admin alone could set `governance` to a key it
/// held, and then co-sign as governance a moment later — so the largest
/// fund-flow control in the system was one key in two transactions. And in the
/// intended wiring the same instruction is the opposite problem: once
/// `governance` is the GOV program's PDA it can never sign an `update_wiring`
/// (GOV's only CPI is `set_round`), so treasury, bank_treasury and split_bps
/// become UNROTATABLE. The requirement was either unsatisfiable or trivially
/// satisfiable, and never in between.
///
/// A timelock is what makes it real in both directions. Admin can still rotate
/// governance — that escape hatch has to exist, or a bug in GOV would freeze the
/// round forever — but only after days in the open, with the pending value
/// readable on-chain and the Bank alarm treating it as CRITICAL drift the moment
/// it appears. Holders get that window to look at it. Nobody gets a silent swap.
///
/// It is a CONFIG VALUE WITH A FLOOR, and RATCHETS UP ONLY, for the same reason
/// `gov.min_voting_secs` is: a hard seven-day constant cannot be exercised on a
/// validator without waiting seven days, and an apply path that has never run is
/// not a path to trust with the largest fund-flow control in the system. Unlike
/// that one it can be RAISED after the fact, so a floor set by mistake at launch
/// is fixable rather than permanent. ⚠️ THE DEPLOYED VALUE MUST BE DAYS. The Bank
/// alarm asserts the live value.
const MIN_GOVERNANCE_TIMELOCK_SECS: i64 = 60;
const MAX_GOVERNANCE_TIMELOCK_SECS: i64 = 30 * 24 * 3600;
/// A sweep cooldown longer than this would be its own denial of service.
const MAX_SWEEP_COOLDOWN_SECS: i64 = 7 * 24 * 3600;
/// A cooldown of ZERO was accepted on-chain — the exact configuration the Bank
/// alarm calls CRITICAL and "not a bound", because two sweeps in one transaction
/// share a timestamp and a cap without a rate limit is a step size. One second
/// closes that absolutely (the second sweep in a transaction sees the same
/// `unix_timestamp`) and is still short enough to exercise the path in a test.
/// ⚠️ THE DEPLOYED VALUE MUST BE HOURS. The Bank alarm asserts it.
const MIN_SWEEP_COOLDOWN_SECS: i64 = 1;
/// THE BOUND ON THE BOUND. Round 11, from two directions at once.
///
/// "Tightening is always admin's to do today" was written about an attacker who
/// has stolen the operator key, and it is false in the other direction: admin
/// ALONE could raise the cooldown to seven days and drop the cap to one lamport,
/// which sweeps a lamport a week while SOL piles up in the revenue address.
/// Undoing either needs the governance signature — which in production is a PDA
/// that can only sign `set_round` — so recovery means a governance rotation, and
/// a hostile admin holds `cancel_pending_governance` and can block it forever.
/// A wedge is not the same as a theft and it is still the pipeline stopped.
///
/// So admin may tighten only as far as a WORKING pipeline: past these, the
/// holders are involved. The emergency response was never this anyway —
/// `set_paused` is admin-only and stops the sweep in the same transaction.
const MAX_ADMIN_SWEEP_COOLDOWN_SECS: i64 = 24 * 3600;
const MIN_ADMIN_SWEEP_LAMPORTS: u64 = 1_000_000_000;      // 1 SOL
/// And the ceiling the business has always STATED. `bank/revenue.mjs` has held
/// `MAX_PER_CYCLE_LAMPORTS = 50 SOL` since it was written, the docs say 50 SOL,
/// and the program required only `> 0` — so the one trusted hop's per-cycle
/// exposure was whatever the config happened to say, and the test suite proved
/// the point by running the whole system at a 100 SOL cap. An off-chain constant
/// cannot bound a caller. Raising this is a program upgrade, deliberately.
const MAX_SWEEP_LAMPORTS: u64 = 50_000_000_000;           // 50 SOL
/// Rent exemption for a 0-byte system account. A reserve BETWEEN zero and this
/// is the one setting that wedges every sweep forever: the transfer would leave
/// a rent-paying account and the runtime rejects it, so `revenue.mjs` marks the
/// send refused and does it again every six hours. Zero is fine (the PDA simply
/// closes and is recreated by the next payment); anything in between is not.
const RENT_EXEMPT_0_BYTES: u64 = 890_880;

#[program]
pub mod cbob_vault_mint {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        collection: Pubkey,
        bank: Pubkey,
        governance: Pubkey,
        treasury: Pubkey,
        bank_treasury: Pubkey,
        swap_operator: Pubkey,
        sol_reserve_lamports: u64,
        max_supply: u64,
        max_sweep_lamports: u64,
        sweep_cooldown_secs: i64,
        governance_timelock_secs: i64,
        level_caps: [u32; 5],
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), INIT_AUTHORITY, MintError::NotTheInitAuthority);
        // There is no "unlimited" sentinel. A supply cap that can be expressed as
        // zero is a supply cap that will be zero by accident.
        require!(max_supply > 0, MintError::BadSupplyCap);
        // THE CEILING BINDS AT INIT TOO. Bounding only the update path leaves the
        // one value that is never updated — the launch value — unbounded.
        //
        // ROUND 12: and so do the WEDGE FLOORS, for the same reason stated one
        // line up and then not applied to its sibling. `initialize` accepted
        // max_sweep_lamports = 1 and a seven-day cooldown, so a launch typo
        // wedged the pipeline exactly as round 11 legislated against — and
        // recovery needs a governance rotation, because the GOV PDA cannot sign
        // `update_wiring`. The launch value is the one nobody gets to correct
        // cheaply, so it is the one that most needs the bound.
        require!(max_sweep_lamports >= MIN_ADMIN_SWEEP_LAMPORTS && max_sweep_lamports <= MAX_SWEEP_LAMPORTS,
            MintError::BadSweepBound);
        require!((MIN_SWEEP_COOLDOWN_SECS..=MAX_ADMIN_SWEEP_COOLDOWN_SECS).contains(&sweep_cooldown_secs),
            MintError::BadSweepBound);
        require!(sol_reserve_lamports == 0 || sol_reserve_lamports >= RENT_EXEMPT_0_BYTES, MintError::BadSweepBound);
        require!((MIN_GOVERNANCE_TIMELOCK_SECS..=MAX_GOVERNANCE_TIMELOCK_SECS).contains(&governance_timelock_secs),
            MintError::BadGovernanceRotation);
        // THE CAPS MUST SUM TO SOMETHING THE SUPPLY CEILING ALLOWS, and neither
        // may be zero-by-accident. A level with a zero cap can never be minted,
        // which would silently delete a tier from the schedule rather than
        // failing loudly; and caps summing above `max_supply` would let the
        // level quotas overrun the one ceiling that ratchets down only.
        let cap_total: u64 = level_caps.iter().map(|c| *c as u64).sum();
        require!(level_caps.iter().all(|c| *c > 0), MintError::BadLevelCaps);
        require!(cap_total > 0 && cap_total <= max_supply, MintError::BadLevelCaps);
        let c = &mut ctx.accounts.config;
        c.version = MINT_CONFIG_VERSION;
        c.admin = ctx.accounts.admin.key();
        c.collection = collection;
        c.bank = bank;
        c.governance = governance;
        c.treasury = treasury;
        c.round_id = 0;
        c.opens_at = 0;
        c.closes_at = 0;
        c.price_lamports = 0;
        c.cap = 0;
        c.minted_this_round = 0;
        c.minted_total = 0;
        c.max_supply = max_supply;
        c.level_caps = level_caps;
        c.level_minted = [0; 5];
        c.deck_root = [0; 32];
        c.deck_salt_hash = [0; 32];
        c.deck_slot = 0;
        c.deck_seed = [0; 32];
        c.bank_treasury = bank_treasury;
        c.split_bps = DEFAULT_SPLIT_BPS;
        c.paused = false;
        c.swap_operator = swap_operator;
        c.sol_reserve_lamports = sol_reserve_lamports;
        c.bump = ctx.bumps.config;
        c.max_sweep_lamports = max_sweep_lamports;
        c.sweep_cooldown_secs = sweep_cooldown_secs;
        c.last_sweep_at = 0;
        c.pending_governance = Pubkey::default();
        c.pending_governance_at = 0;
        c.governance_timelock_secs = governance_timelock_secs;
        c.pending_admin = Pubkey::default();
        c.pending_admin_at = 0;
        c.pending_bank = Pubkey::default();
        c.pending_bank_at = 0;
        c.pending_operator = Pubkey::default();
        c.pending_operator_at = 0;
        emit!(WiringUpdated { collection, bank, governance, treasury, bank_treasury,
            admin: c.admin, max_supply, split_bps: c.split_bps, paused: false });
        Ok(())
    }

    /// Admin may rotate the wiring. It may NOT set the round or the price — that is
    /// the governors' job and theirs alone.
    ///
    /// `collection` is NOT rotatable, matching SEAL and BURN. It is stamped into
    /// every AssetV1 header at mint, and MINT's own cross-check against the SEAL
    /// config (which cannot rotate it either) meant a MINT-side change could only
    /// ever halt minting. A field whose only reachable effect is a kill switch
    /// should not exist.
    ///
    /// `treasury` requires the GOVERNANCE signature as well as admin. 100% of the
    /// mint price flows there and 85% of it is owed to vault holders, so it is the
    /// largest fund-flow control in the system; it should not sit behind one key.
    /// `max_supply` RATCHETS DOWN ONLY — the cap is a promise to buyers, and a
    /// promise one signature can raise is not a cap.
    pub fn update_wiring(
        ctx: Context<UpdateWiring>,
        bank: Option<Pubkey>,
        governance: Option<Pubkey>,
        treasury: Option<Pubkey>,
        admin: Option<Pubkey>,
        max_supply: Option<u64>,
        bank_treasury: Option<Pubkey>,
        split_bps: Option<u16>,
        swap_operator: Option<Pubkey>,
        sol_reserve_lamports: Option<u64>,
        max_sweep_lamports: Option<u64>,
        sweep_cooldown_secs: Option<i64>,
        governance_timelock_secs: Option<i64>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.config;
        // WHO GETS PAID needs governance. TIGHTENING A BOUND does not.
        //
        // Round 6 put every one of these behind the governance signature, and the
        // production wiring makes that signature UNOBTAINABLE: once `governance`
        // is the GOV program's PDA it can only ever sign a `set_round`. So the
        // emergency response to a compromised swap-operator key — replacing it —
        // was locked behind a seven-day governance rotation, during which the
        // attacker keeps taking `max_sweep_lamports` every cooldown. A control
        // that cannot be used in the emergency it exists for is not a control.
        //
        // The split is by DIRECTION, not by field. Anything that can only ever
        // reduce our exposure is admin's to do TODAY; anything that changes who
        // receives money, or loosens a bound, still needs the holders.
        let needs_governance = treasury.is_some() || bank_treasury.is_some() || split_bps.is_some()
            || sol_reserve_lamports.is_some()
            || governance_timelock_secs.is_some()
            || max_sweep_lamports.map_or(false, |x| x > c.max_sweep_lamports || x < MIN_ADMIN_SWEEP_LAMPORTS)
            || sweep_cooldown_secs.map_or(false, |x| x < c.sweep_cooldown_secs || x > MAX_ADMIN_SWEEP_COOLDOWN_SECS);
        if needs_governance {
            let gov = ctx.accounts.governance.as_ref().ok_or(MintError::TreasuryNeedsGovernance)?;
            require_keys_eq!(gov.key(), c.governance, MintError::TreasuryNeedsGovernance);
        }
        if let Some(x) = treasury { c.treasury = x; }
        if let Some(x) = bank_treasury { c.bank_treasury = x; }
        if let Some(x) = split_bps {
            // Whole percent only. The old justification here ("so the royalty
            // plugin can express it") named a mechanism that does not exist —
            // `set_collection_royalties` writes ONE creator at 100% and never
            // reads `split_bps`. The constraint is kept anyway, for the reason
            // that actually holds: 85/15 is a promise made to holders in whole
            // percent, and a split of 8537 bps is a number nobody agreed to.
            require!(x <= 10_000 && x % 100 == 0, MintError::BadSplit);
            c.split_bps = x;
        }
        if let Some(x) = max_supply {
            require!(x > 0 && x <= c.max_supply, MintError::BadSupplyCap);
            require!(x >= c.minted_total, MintError::BadSupplyCap);
            c.max_supply = x;
        }
        // THE OPERATOR WAITS TOO. Round 8 made this admin-only under the argument
        // that "replacing the swap operator cannot redirect anyone's money". That
        // is false and it is the plainest kind of false: the operator address is
        // WHERE THE SWEPT SOL GOES. One admin signature pointing it at a key the
        // admin holds, followed by a permissionless sweep, is the treasury.
        //
        // The immediate emergency response is `set_paused`, which is admin-only,
        // takes effect in the same transaction, and stops `sweep_sol_for_swap`
        // outright — so nothing is lost by making the rotation itself slow. Stop
        // the bleeding now; change the address in public.
        if let Some(x) = swap_operator {
            require_keys_neq!(x, Pubkey::default(), MintError::WrongTreasury);
            c.pending_operator = x;
            c.pending_operator_at = now.checked_add(c.governance_timelock_secs).ok_or(MintError::Overflow)?;
            emit!(OperatorRotationArmed { pending: x, effective_at: c.pending_operator_at });
        }
        if let Some(x) = sol_reserve_lamports {
            require!(x == 0 || x >= RENT_EXEMPT_0_BYTES, MintError::BadSweepBound);
            c.sol_reserve_lamports = x;
        }
        if let Some(x) = max_sweep_lamports {
            require!(x > 0 && x <= MAX_SWEEP_LAMPORTS, MintError::BadSweepBound);
            c.max_sweep_lamports = x;
        }
        if let Some(x) = sweep_cooldown_secs {
            require!((MIN_SWEEP_COOLDOWN_SECS..=MAX_SWEEP_COOLDOWN_SECS).contains(&x), MintError::BadSweepBound);
            c.sweep_cooldown_secs = x;
        }
        // RATCHET UP ONLY. Admin lowering its own notice period would undo the
        // whole point; raising it is a hardening step and a repair for a launch
        // value set too low.
        if let Some(x) = governance_timelock_secs {
            require!(x >= c.governance_timelock_secs && x <= MAX_GOVERNANCE_TIMELOCK_SECS,
                MintError::BadGovernanceRotation);
            c.governance_timelock_secs = x;
        }
        // THE BANK CO-SIGNS EVERY MINT, and rotated on one admin signature with
        // no notice at all — while `governance` and `admin` beside it are both
        // timelocked. The Bank's refusal is what stops a mint that plants a
        // delegate or an undeclared token account, so replacing it quietly is
        // replacing the only party who says no.
        if let Some(x) = bank {
            require_keys_neq!(x, Pubkey::default(), MintError::BadGovernanceRotation);
            c.pending_bank = x;
            c.pending_bank_at = now.checked_add(c.governance_timelock_secs).ok_or(MintError::Overflow)?;
            emit!(BankRotationArmed { pending: x, effective_at: c.pending_bank_at });
        }
        // GOVERNANCE IS NOT ROTATED HERE. It is ARMED here and applied later by
        // `apply_pending_governance`, once GOVERNANCE_TIMELOCK_SECS have passed
        // in public. See the constant for why: without this, admin alone could
        // appoint itself governance and then satisfy every governance gate below
        // in the very next transaction.
        if let Some(x) = governance {
            require_keys_neq!(x, Pubkey::default(), MintError::BadGovernanceRotation);
            let now = Clock::get()?.unix_timestamp;
            c.pending_governance = x;
            c.pending_governance_at = now.checked_add(c.governance_timelock_secs).ok_or(MintError::Overflow)?;
            emit!(GovernanceRotationArmed { pending: x, effective_at: c.pending_governance_at });
        }
        // ADMIN IS ARMED, NOT ROTATED, for the reason the governance timelock
        // exists — and for one more. `cancel_pending_governance` is `has_one =
        // admin`, so an attacker who could rotate admin INSTANTLY would take the
        // cancel away from the honest side and then arm a governance rotation
        // nobody could stop. The timelock's only remedy was disarmable through
        // the field next to it.
        if let Some(x) = admin {
            require_keys_neq!(x, Pubkey::default(), MintError::BadGovernanceRotation);
            c.pending_admin = x;
            c.pending_admin_at = now.checked_add(c.governance_timelock_secs).ok_or(MintError::Overflow)?;
            emit!(AdminRotationArmed { pending: x, effective_at: c.pending_admin_at });
        }
        emit!(WiringUpdated { collection: c.collection, bank: c.bank, governance: c.governance,
            treasury: c.treasury, bank_treasury: c.bank_treasury, admin: c.admin,
            max_supply: c.max_supply, split_bps: c.split_bps, paused: c.paused });
        Ok(())
    }

    /// Apply a governance rotation the timelock has now released.
    ///
    /// PERMISSIONLESS on purpose, exactly like `split_revenue`: there is nothing
    /// to choose. The value was fixed and published a notice period ago and the
    /// only question is whether the clock has passed it. Making a stranger able to
    /// finish the job means the rotation cannot be held hostage by whoever holds
    /// the admin key changing their mind about landing it.
    pub fn apply_pending_governance(ctx: Context<ApplyPendingGovernance>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_governance, Pubkey::default(), MintError::NoPendingGovernance);
        require!(now >= c.pending_governance_at, MintError::GovernanceTimelockActive);
        c.governance = c.pending_governance;
        c.pending_governance = Pubkey::default();
        c.pending_governance_at = 0;
        emit!(WiringUpdated { collection: c.collection, bank: c.bank, governance: c.governance,
            treasury: c.treasury, bank_treasury: c.bank_treasury, admin: c.admin,
            max_supply: c.max_supply, split_bps: c.split_bps, paused: c.paused });
        Ok(())
    }

    /// Apply an admin rotation the notice period has released. Permissionless for
    /// the same reason `apply_pending_governance` is: nothing is left to choose.
    pub fn apply_pending_admin(ctx: Context<ApplyPendingGovernance>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_admin, Pubkey::default(), MintError::NoPendingGovernance);
        require!(now >= c.pending_admin_at, MintError::GovernanceTimelockActive);
        c.admin = c.pending_admin;
        c.pending_admin = Pubkey::default();
        c.pending_admin_at = 0;
        // IT DOES NOT TOUCH THE BANK ROTATION. It did, because the two-line clear
        // was pattern-matched into this handler as well as into `initialize` —
        // so a permissionless `apply_pending_admin` silently deleted a Bank
        // rotation that was waiting out the same notice period, and the alarm
        // would have reported neither the arming nor the deletion. Each rotation
        // lands or is cancelled on its own.
        emit!(WiringUpdated { collection: c.collection, bank: c.bank, governance: c.governance,
            treasury: c.treasury, bank_treasury: c.bank_treasury, admin: c.admin,
            max_supply: c.max_supply, split_bps: c.split_bps, paused: c.paused });
        Ok(())
    }

    /// Apply a Bank rotation the notice period has released.
    pub fn apply_pending_bank(ctx: Context<ApplyPendingGovernance>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_bank, Pubkey::default(), MintError::NoPendingGovernance);
        require!(now >= c.pending_bank_at, MintError::GovernanceTimelockActive);
        c.bank = c.pending_bank;
        c.pending_bank = Pubkey::default();
        c.pending_bank_at = 0;
        emit!(WiringUpdated { collection: c.collection, bank: c.bank, governance: c.governance,
            treasury: c.treasury, bank_treasury: c.bank_treasury, admin: c.admin,
            max_supply: c.max_supply, split_bps: c.split_bps, paused: c.paused });
        Ok(())
    }

    /// Apply an operator rotation the notice period has released.
    pub fn apply_pending_operator(ctx: Context<ApplyPendingGovernance>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_operator, Pubkey::default(), MintError::NoPendingGovernance);
        require!(now >= c.pending_operator_at, MintError::GovernanceTimelockActive);
        c.swap_operator = c.pending_operator;
        c.pending_operator = Pubkey::default();
        c.pending_operator_at = 0;
        Ok(())
    }

    /// Disarm an operator rotation. Admin only.
    pub fn cancel_pending_operator(ctx: Context<CancelPendingGovernance>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_operator, Pubkey::default(), MintError::NoPendingGovernance);
        c.pending_operator = Pubkey::default();
        c.pending_operator_at = 0;
        Ok(())
    }

    /// Disarm a Bank rotation. Admin only.
    pub fn cancel_pending_bank(ctx: Context<CancelPendingGovernance>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_bank, Pubkey::default(), MintError::NoPendingGovernance);
        emit!(BankRotationCancelled { was: c.pending_bank });
        c.pending_bank = Pubkey::default();
        c.pending_bank_at = 0;
        Ok(())
    }

    /// Disarm an admin rotation. Admin only — the current one, which is the
    /// point: an armed rotation cannot remove the person who can cancel it.
    pub fn cancel_pending_admin(ctx: Context<CancelPendingGovernance>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_admin, Pubkey::default(), MintError::NoPendingGovernance);
        emit!(AdminRotationCancelled { was: c.pending_admin });
        c.pending_admin = Pubkey::default();
        c.pending_admin_at = 0;
        Ok(())
    }

    /// Disarm a governance rotation before it lands. Admin only — the same key
    /// that armed it. A timelock with no cancel makes an accidental keystroke
    /// irreversible for the whole notice period.
    pub fn cancel_pending_governance(ctx: Context<CancelPendingGovernance>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_governance, Pubkey::default(), MintError::NoPendingGovernance);
        emit!(GovernanceRotationCancelled { was: c.pending_governance });
        c.pending_governance = Pubkey::default();
        c.pending_governance_at = 0;
        Ok(())
    }

    /// EMERGENCY OFF. Admin only, immediate, no vote.
    ///
    /// Deliberately separate from the round: a round is a governance decision and
    /// takes a vote, but stopping the sale when something is wrong cannot wait for
    /// one. Pausing does not touch the round, so unpausing resumes exactly where it
    /// was rather than needing governance to re-ratify what it already decided.
    /// Redemptions and burns are NOT affected — a member can always get their
    /// Bitcoin out of a vault they already hold, whatever the sale is doing.
    /// Commit the shuffled deck, ONCE. See the DECK block at the top of this file.
    ///
    /// ⚠️ ONE-SHOT IS THE CONTROL, NOT A CONVENIENCE. A root that can be replaced
    /// is a deck that can be re-dealt after seeing who showed up, which is
    /// precisely the favouritism the commitment exists to prevent. So this
    /// refuses once `deck_root` is non-zero, and there is deliberately no
    /// instruction anywhere that clears it.
    ///
    /// The all-zero root is the "not committed" sentinel and is refused as an
    /// argument: a caller passing a default-initialised buffer must not be able
    /// to leave the deck uncommitted while believing it committed one.
    /// STEP ONE OF TWO: fix the salt before the entropy it will be mixed with
    /// exists.
    ///
    /// ⚠️ ROUND 20, SIX AUDITORS OF SIX, AND THEY WERE RIGHT. Until this
    /// instruction existed, the seed scheme described at the top of this file and
    /// in `bank/deck.mjs` was enforced by NOTHING. `commit_deck` took a root and
    /// stored it. Any 32 bytes. A grep of this whole directory for `bank_salt`,
    /// `salt_hash`, `reveal` or `commit_slot` returned exactly one hit and it was
    /// a comment. The Bank could hand-build a deck, commit its root, and — because
    /// the Bank co-signs every mint and therefore controls the ORDER minters
    /// arrive in — hand the good cards to whoever it liked. That is the precise
    /// thing levels-at-mint was built to prevent, and it was the Bank's word.
    ///
    /// A THEOREM IN A COMMENT IS A CLAIM, NOT A CONTROL.
    ///
    /// The fix is not to make the program verify the deck — it cannot; rebuilding
    /// a 2,100-card shuffle in BPF is not something to add days before a freeze.
    /// The fix is to make the SEED unforgeable and PUBLIC. Deck derivation is
    /// already a deterministic public function of (census, seed), so once the seed
    /// is on chain, any holder can recompute the entire deal and check every
    /// vault's level against it, forever, without the Bank's cooperation.
    ///
    /// That also deletes the second finding rather than answering it. There was no
    /// reveal instruction, no deadline and no penalty, so a Bank that dealt itself
    /// the good cards could simply never reveal and no one could prove anything.
    /// **There is now nothing to reveal.** The seed is written on chain by the
    /// program, from a salt the Bank cannot change and a blockhash it cannot
    /// predict. Non-revelation is not mitigated; it is impossible.
    ///
    /// ONE-SHOT, for the same reason `commit_deck` is: a salt that can be replaced
    /// is a draw that can be repeated.
    pub fn commit_seed(ctx: Context<CommitSeed>, salt_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.slot;
        let c = &mut ctx.accounts.config;
        require!(c.deck_salt_hash == [0u8; 32], MintError::SeedAlreadyCommitted);
        // The all-zero hash is the "not committed" sentinel. A caller passing a
        // default-initialised buffer must not leave the seed uncommitted while
        // believing it committed one — the same argument as the all-zero root.
        require!(salt_hash != [0u8; 32], MintError::BadSaltHash);
        c.deck_salt_hash = salt_hash;
        c.deck_slot = now.checked_add(DECK_SLOT_LEAD).ok_or(MintError::Overflow)?;
        emit!(DeckSeedCommitted { salt_hash, slot: c.deck_slot });
        Ok(())
    }

    /// Commit the shuffled deck, ONCE. See the DECK block at the top of this file.
    ///
    /// ⚠️ ONE-SHOT IS THE CONTROL, NOT A CONVENIENCE. A root that can be replaced
    /// is a deck that can be re-dealt after seeing who showed up, which is
    /// precisely the favouritism the commitment exists to prevent. So this
    /// refuses once `deck_root` is non-zero, and there is deliberately no
    /// instruction anywhere that clears it.
    ///
    /// The all-zero root is the "not committed" sentinel and is refused as an
    /// argument: a caller passing a default-initialised buffer must not be able
    /// to leave the deck uncommitted while believing it committed one.
    ///
    /// STEP TWO OF TWO. It now takes the SALT, not just a root, and derives the
    /// seed itself from the salt plus the blockhash of the slot `commit_seed`
    /// fixed. Neither input is the caller's to choose by the time this runs: the
    /// salt is pinned by a hash committed before that slot existed, and the slot
    /// is arithmetic. The seed is then STORED, which is what makes the deal
    /// checkable by anyone forever.
    ///
    /// It still does not verify that `root` is the deck of that seed — it cannot.
    /// What it guarantees is that a root which is NOT that deck is now provably
    /// wrong to every observer, instead of being indistinguishable from a fair
    /// one. `bank/selftest.mjs` and the on-chain suite check the relationship, and
    /// the alarm watches it in production.
    pub fn commit_deck(ctx: Context<CommitDeck>, root: [u8; 32], salt: [u8; 32]) -> Result<()> {
        // ⚠️ THE ONE-SHOT CHECK GOES FIRST, AND ROUND 20'S SUITE IS WHY.
        //
        // It was last. Every other check still refused a re-deal, so nothing was
        // OPEN — but the error an operator got was wrong, and the suite proved it:
        // by the time the re-deal arm runs, the entropy slot has aged out of
        // SlotHashes, so a second `commit_deck` was refused as
        // `DeckSlotUnavailable`. A REJECT FOR THE WRONG REASON IS A FALSE PASS,
        // and `because('11.9', 'DeckAlreadyCommitted')` is what caught it.
        //
        // The ordering matters beyond the message. "One-shot is the control" is
        // the strongest statement this instruction makes; a caller must hear it
        // from the check that enforces it, not from whichever guard happens to
        // fire first as the clock moves.
        require!(ctx.accounts.config.deck_root == [0u8; 32], MintError::DeckAlreadyCommitted);
        require!(root != [0u8; 32], MintError::BadDeckRoot);
        // Read before the mutable borrow: the sysvar walk needs `deck_slot`.
        let want = ctx.accounts.config.deck_slot;
        let committed = ctx.accounts.config.deck_salt_hash;
        require!(committed != [0u8; 32], MintError::SeedNotCommitted);
        // ⚠️ SHA256 OF THE SALT, MATCHING `sha256(bank_salt)` IN bank/deck.mjs.
        // Two implementations of one hash scheme is this repository's most
        // repeated defect; the suite proves they agree by having THIS program
        // accept a salt hashed by THAT module, which is the only check that can
        // fail if they drift.
        require!(hashv(&[&salt]).to_bytes() == committed, MintError::BadSalt);
        let bh = blockhash_of_slot(&ctx.accounts.slot_hashes, want)?;
        let c = &mut ctx.accounts.config;
        let seed = hashv(&[&salt, &bh]).to_bytes();
        c.deck_seed = seed;
        c.deck_root = root;
        emit!(DeckCommitted { root, seed, slot: want });
        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PausedChanged { paused });
        Ok(())
    }

    /// Point the COLLECTION's Royalties plugin at THE revenue address, so a
    /// secondary sale earns the project the same way a primary mint does and the
    /// proceeds land in the same place, to be divided by the same `split_revenue`.
    ///
    /// ONE ADDRESS, NOT ONE NUMBER. This comment used to say "one number, both
    /// revenue paths", which was never true: `basis_points` is the ROYALTY RATE a
    /// marketplace charges on a resale, and `split_bps` is how income is divided
    /// once it arrives. They are different quantities and this instruction has
    /// never derived one from the other. What IS shared is the destination: a
    /// single creator at 100%, the `["revenue"]` PDA, so royalties go through the
    /// identical swap and the identical enforced split as everything else.
    ///
    /// ⚠️ ORDER OF OPERATIONS. `governance` must SIGN here, so this has to be done
    /// while governance is still a key that can sign — i.e. BEFORE governance is
    /// handed to the GOV program's PDA, which can only ever sign a `set_round`.
    /// Afterwards the only route is the governance rotation timelock.
    pub fn set_collection_royalties(ctx: Context<SetCollectionRoyalties>, basis_points: u16, add: bool) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require_keys_eq!(ctx.accounts.collection.key(), cfg.collection, MintError::WrongCollection);
        // A 100% royalty is legal in the plugin and fatal to the product: the
        // entire thesis is that a vault is RESOLD, and no marketplace clears a
        // sale where the whole price is owed to the creator. `<= 10_000` bounded
        // the byte and nothing that mattered.
        require!(basis_points <= MAX_ROYALTY_BPS, MintError::BadRoyalty);
        // ONE creator: the revenue address. Splitting at the marketplace would put
        // SOL in two places and neither of them would be cbBTC; routing 100% here
        // means every lamport of royalty goes through the same swap and the same
        // enforced split as every other income source.
        let (revenue, _) = Pubkey::find_program_address(&[REVENUE_SEED], &crate::ID);

        let mut data = vec![
            if add { IX_ADD_COLLECTION_PLUGIN_V1 } else { IX_UPDATE_COLLECTION_PLUGIN_V1 },
            PLUGIN_ROYALTIES,
        ];
        data.extend_from_slice(&basis_points.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());               // creators
        data.extend_from_slice(revenue.as_ref()); data.push(100);
        data.push(RULESET_NONE);
        if add { data.push(0); }                                    // Option<authority> = None

        let ix = Instruction {
            program_id: MPL_CORE_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.collection.key(), false),
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new_readonly(ctx.accounts.mint_authority.key(), true),
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                AccountMeta::new_readonly(MPL_CORE_ID, false),
            ],
            data,
        };
        invoke_signed(&ix, &[
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.mint_authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.mpl_core.to_account_info(),
        ], &[&[MINT_SEED, &[ctx.bumps.mint_authority]]])?;
        emit!(RoyaltiesSet { basis_points, revenue });
        Ok(())
    }

    /// THE RATIFIED VOTE LANDS HERE. Two fields: when, and how much.
    /// Callable only by `config.governance` — the governance program's authority.
    pub fn set_round(
        ctx: Context<SetRound>,
        opens_at: i64,
        closes_at: i64,
        price_lamports: u64,
        cap: u32,
    ) -> Result<()> {
        require!(closes_at > opens_at, MintError::BadWindow);
        // `closes_at = i64::MAX` was expressible: a round that never closes.
        // checked_sub, not `-`. `overflow-checks = true` in the workspace profile
        // means a raw subtraction aborts instead of wrapping, so this was never
        // exploitable — but it left the bound's safety resting on a build setting
        // nothing in the program asserts.
        require!(closes_at.checked_sub(opens_at).ok_or(MintError::BadWindow)? <= MAX_ROUND_SECS,
            MintError::BadWindow);
        // `cap == 0` used to mean UNLIMITED. Combined with a never-closing window
        // that made "unlimited vaults forever" a single ratified vote. There is no
        // unlimited sentinel any more; the lifetime cap in mint_vault is the outer
        // bound and this is the per-round one.
        require!(cap > 0, MintError::BadCap);
        // NOTE: price_lamports == 0 is DELIBERATELY still legal. The charter round
        // is free by design (Gary, 2026-08-13), so a minimum price would break the
        // business the first time it was used. Auditors flagged price 0 as a
        // finding; it is a requirement.
        let c = &mut ctx.accounts.config;
        c.round_id = c.round_id.checked_add(1).ok_or(MintError::Overflow)?;
        c.opens_at = opens_at;
        c.closes_at = closes_at;
        c.price_lamports = price_lamports;
        c.cap = cap;
        c.minted_this_round = 0;
        emit!(RoundSet { round_id: c.round_id, opens_at, closes_at, price_lamports, cap });
        Ok(())
    }

    /// THE 85/15, ENFORCED. Permissionless: anyone may call it, because the
    /// destinations are pinned in config and the ratio is pinned in config. There
    /// is nothing to gain by calling it and nothing to choose, which is exactly
    /// what you want of the instruction that moves the holders' money.
    ///
    /// Works for ANY token, so a future income source denominated in something
    /// else needs no new code. The BANK's share is floored and the holders take
    /// the REMAINDER, so integer division rounds toward the holders and the two
    /// transfers still sum to the balance exactly.
    ///
    /// This paragraph said the opposite until round 6, and so did the code: the
    /// holders' share was computed first and the Bank collected every remainder.
    /// Dust — but the fix and its own description were corrected in two different
    /// places, and this one was found by grepping for the claim rather than by
    /// reading the diff.
    ///
    /// WHAT THIS CANNOT DO: the SOL -> cbBTC swap. There is no trustless swap
    /// without a DEX CPI, so that hop is off-chain and named
    /// (`sweep_sol_for_swap`), bounded, and reconciled by the Bank alarm. The
    /// split of whatever cbBTC arrives here IS enforced.
    pub fn split_revenue(ctx: Context<SplitRevenue>, decimals: u8) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let (revenue, rev_bump) = Pubkey::find_program_address(&[REVENUE_SEED], &crate::ID);
        require_keys_eq!(ctx.accounts.revenue.key(), revenue, MintError::WrongTreasury);

        let expect = |wallet: &Pubkey| Pubkey::find_program_address(
            &[wallet.as_ref(), SPL_TOKEN_ID.as_ref(), ctx.accounts.mint.key().as_ref()], &ATA_PROGRAM_ID).0;
        require_keys_eq!(ctx.accounts.revenue_ata.key(), expect(&revenue), MintError::WrongTreasury);
        require_keys_eq!(ctx.accounts.holders_ata.key(), expect(&cfg.treasury), MintError::WrongTreasury);
        require_keys_eq!(ctx.accounts.bank_ata.key(), expect(&cfg.bank_treasury), MintError::WrongTreasury);

        let total = {
            let d = ctx.accounts.revenue_ata.try_borrow_data()?;
            require!(d.len() >= 72, MintError::WrongTreasury);
            let mut a = [0u8; 8]; a.copy_from_slice(&d[64..72]);
            u64::from_le_bytes(a)
        };
        require!(total > 0, MintError::NothingToSplit);
        // THE BANK'S SHARE IS THE ONE THAT GETS FLOORED, and the holders take the
        // remainder. The comment above used to claim integer division "can never
        // round in the Bank's favour" while the code computed the holders' share
        // first and handed the Bank whatever was left — which is precisely the
        // Bank collecting every rounding remainder. It is at most one unit per
        // call, and a rule that is stated backwards is worth correcting whatever
        // it is worth in money.
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
            }, &[
                ctx.accounts.revenue_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                dest.to_account_info(),
                ctx.accounts.revenue.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ], &[&[REVENUE_SEED, &[rev_bump]]])?;
        }
        emit!(RevenueSplit { mint: ctx.accounts.mint.key(), total, holders, bank: bank_cut, split_bps: cfg.split_bps });
        Ok(())
    }

    /// Move SOL out of the revenue address to the pinned swap operator, which
    /// converts it to cbBTC off-chain and deposits the result BACK here for
    /// `split_revenue` to divide.
    ///
    /// THIS IS THE ONE TRUSTED HOP IN THE REVENUE PATH, and it is deliberately
    /// small: the destination is PINNED IN CONFIG (never a caller argument), a SOL
    /// reserve is always left behind for fees, and every sweep emits an event so
    /// the Bank alarm can reconcile SOL-out against cbBTC-returned and shout when
    /// they diverge. It cannot be made trustless without a DEX CPI.
    ///
    /// THE OPERATOR SIGNS. It does not need the multisig — that was the reason it
    /// was opened up in round 5, and that reason still holds — but "permissionless"
    /// was a mistake, and round 6 made it a worse one by adding a cooldown.
    ///
    /// The old argument was that a stranger can only move OUR SOL to OUR pinned
    /// operator, so a stranger calling this "is doing us a favour". With a rate
    /// limit in place that stopped being true: anyone could call
    /// `sweep_sol_for_swap(0)` once per cooldown, stamp `last_sweep_at`, and starve
    /// the real cycle forever for the price of a transaction fee — while the alarm
    /// said nothing, because nothing watched sweeps. The cooldown that bounds a
    /// compromised key also hands a griefer a handle, and the only thing that takes
    /// the handle away is requiring the one key that is supposed to be calling this.
    /// The cron holds it, so nothing about the automation changes.
    ///
    /// `amount > 0` for the same reason: a zero-lamport sweep moves nothing and
    /// consumes the whole window.
    pub fn sweep_sol_for_swap(ctx: Context<SweepSolForSwap>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, MintError::MintPaused);
        require!(amount > 0, MintError::SweepAboveCap);
        require_keys_eq!(ctx.accounts.swap_operator.key(), cfg.swap_operator, MintError::WrongTreasury);
        // THE CAP AND THE COOLDOWN ARE ON-CHAIN BECAUSE THE CLAIM WAS ON-CHAIN.
        // `bank/revenue.mjs` held a 50 SOL MAX_PER_CYCLE constant and the comment
        // beside it said a compromised operator key "is capped at one cycle's
        // worth rather than the whole treasury". That was false: this instruction
        // is permissionless, so whoever holds the operator key can simply send
        // their own sweep for the entire balance, and a script's constant binds
        // nobody. The cap without the cooldown is no better — the same caller
        // just puts N sweeps in one transaction. Both, or neither is a bound.
        require!(amount <= cfg.max_sweep_lamports, MintError::SweepAboveCap);
        require!(now >= cfg.last_sweep_at.checked_add(cfg.sweep_cooldown_secs).ok_or(MintError::Overflow)?,
            MintError::SweepTooSoon);
        let (revenue, rev_bump) = Pubkey::find_program_address(&[REVENUE_SEED], &crate::ID);
        require_keys_eq!(ctx.accounts.revenue.key(), revenue, MintError::WrongTreasury);
        let bal = ctx.accounts.revenue.lamports();
        let keep = cfg.sol_reserve_lamports;
        require!(bal >= keep.checked_add(amount).ok_or(MintError::Overflow)?, MintError::ReserveWouldBreach);
        let operator = cfg.swap_operator;
        invoke_signed(
            &system_instruction::transfer(&revenue, &ctx.accounts.swap_operator.key(), amount),
            &[ctx.accounts.revenue.to_account_info(), ctx.accounts.swap_operator.to_account_info()],
            &[&[REVENUE_SEED, &[rev_bump]]])?;
        let c = &mut ctx.accounts.config;
        c.last_sweep_at = now;
        emit!(SolSweptForSwap { amount, operator, remaining: bal - amount });
        Ok(())
    }

    /// Mint a vault. The plugin set is fixed here; governance cannot touch it.
    /// `max_price_lamports` is the payer's slippage guard. `set_round` can reprice
    /// instantly, so without it a governor can raise the price between a buyer
    /// simulating and their transaction landing, and the buyer pays whatever the
    /// config says at execution time. The payer states their own ceiling.
    pub fn mint_vault(ctx: Context<MintVault>, name: String, uri: String, max_price_lamports: u64, attributes: Vec<VaultAttribute>, level: u8, deck_proof: Vec<[u8; 32]>) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, MintError::NameTooLong);
        require!(uri.len() <= MAX_URI_LEN, MintError::UriTooLong);
        // Provenance (Notice serial, Governor standing) is stamped HERE and nowhere
        // else. Once the Proof-of-Burn token is burned and the Notice retired at
        // redemption, the vault is the only record that a holder was charter.
        // ⚠️ STRICTLY LESS THAN. The program APPENDS `level` below, so the caller's
        // budget is MAX_ATTRS - 1. This bound is not cosmetic: it exists because
        // MINT must never write more attributes than SEAL's `mark_opened` can
        // parse and rewrite — if it does, the first redemption fails closed and
        // the vault can never be opened. Spending the last slot on the level
        // would push the total over exactly that line.
        require!(attributes.len() < MAX_ATTRS, MintError::TooManyAttributes);
        for (i, a) in attributes.iter().enumerate() {
            require!(a.key.len() <= MAX_ATTR_STR && a.value.len() <= MAX_ATTR_STR, MintError::TooManyAttributes);
            require!(!a.key.is_empty(), MintError::TooManyAttributes);
            // SEAL owns this key. Letting MINT pre-set it would let a vault be born
            // already claiming to have been redeemed.
            require!(a.key != ATTR_REDEMPTION, MintError::ReservedAttribute);
            // THE PROGRAM OWNS THE LEVEL. See ATTR_LEVEL: without this the minter
            // writes their own and the draw is decoration.
            require!(a.key != ATTR_LEVEL, MintError::ReservedAttribute);
            // ACCEPTED LIMIT 14, CLOSED HERE BECAUSE THE LEVEL MADE IT LOAD-BEARING.
            // Duplicate keys were permitted: bounded, and harmless while attributes
            // were only provenance. They stop being harmless the moment anything
            // READS this map for a number that decides money, because which of two
            // values a reader takes is then a question with two answers. The level
            // itself cannot be duplicated (it is reserved above and appended once),
            // so this closes the general case while it is cheap rather than leaving
            // a sibling of the defect we just legislated against.
            require!(!attributes[..i].iter().any(|b| b.key == a.key), MintError::DuplicateAttribute);
        }
        // THE LEVEL, AND THE QUOTA THAT MAKES IT AN INVARIANT RATHER THAN A PROMISE.
        //
        // 1..=5, never 0: a forgotten or uninitialised argument is zero, and zero
        // must not be a valid level.
        require!(level >= 1 && level <= 5, MintError::BadLevel);
        let li = (level - 1) as usize;
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, MintError::MintPaused);
        require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, MintError::NotTheBank);

        // ---- CONFINE THE BANK'S KEY TO THIS INSTRUCTION ----
        //
        // ⚠️ ROUND 17, CRITICAL, AND IT IS THIS PROJECT'S SIGNATURE DEFECT: ONE OF
        // TWO SITES. Round 15 measured a theft — a Solana signature covers the
        // WHOLE message and the customer composes the transaction, so
        // `[<anything the Bank must sign>, SystemProgram.transfer(from=BANK)]`
        // spends the Bank's SOL on the Bank's own co-signature. Round 17 moved the
        // fix on-chain into SEAL's `open_for_redemption`, and ONLY there.
        //
        // `mint_vault` also takes `bank: Signer`, also pins it to config, and had
        // NEITHER this check NOR any off-chain judge: `judgeRedemptionTx` knows only
        // the open/burn pair and `bank/cosign.mjs` is a redemption tool. The theft
        // stayed live on the sibling instruction — **and on the busier one**. A
        // redemption happens when a customer exits; a mint happens at every
        // activation, 240 times at launch and 2,100 at full scale.
        //
        // Bound honestly: it reaches the Bank's SOL float and can deny-of-service
        // the Bank key behind its seven-day rotation notice. It does NOT reach
        // customer Bitcoin, which sits behind Core's Execute and needs the owner.
        //
        // EXEMPTION: only a `mint_vault` to THIS program. Several mints may share a
        // transaction and each names the Bank exactly as this one does. The FEE
        // PAYER is still invisible here — it appears in no instruction's account
        // list — and stays a policy matter; see SPEC's control table.
        {
            let sysvar = ctx.accounts.instructions.to_account_info();
            let current = load_current_index_checked(&sysvar)? as usize;
            let bank = cfg.bank;
            let mut i = 0usize;
            let mut seen_self = false;
            while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
                let is_mint = ix.program_id == crate::ID
                    && ix.data.len() >= IX_MINT_VAULT_DISC.len()
                    && ix.data[..IX_MINT_VAULT_DISC.len()] == IX_MINT_VAULT_DISC;
                if i == current { seen_self = true; }
                if is_mint {
                    // ⚠️ EXEMPT DOES NOT MEAN UNCHECKED, AND ROUND 18 MEASURED WHY.
                    // The first version waved any `mint_vault` through entirely.
                    // `MintVault` takes `payer: Signer` at index 5 and this handler
                    // transfers `price_lamports` FROM THE PAYER, so
                    // `mint_vault(bank = cfg.bank, payer = cfg.bank, owner = attacker)`
                    // made the Bank buy a stranger a vault — repeatable, bounded
                    // only by the Bank's balance. Two round-18 auditors found it
                    // independently, and a round-17 auditor had already said the
                    // exemption was "wider than it needs to be" and to narrow it to
                    // positional identity. That advice was accepted and not acted
                    // on, and this is what it cost.
                    //
                    // The Bank's key may appear in a mint ONLY in the `bank` slot.
                    for (n, a) in ix.accounts.iter().enumerate() {
                        require!(a.pubkey != bank || n == MINT_IX_BANK_IDX,
                            MintError::BankKeyOutsideMint);
                    }
                } else {
                    require!(
                        !ix.accounts.iter().any(|a| a.pubkey == bank),
                        MintError::BankKeyOutsideMint
                    );
                }
                i += 1;
            }
            // FAIL CLOSED IF THE WALK DID NOT REACH US. `while let Ok(..)` stops at
            // the first Err, and an early stop would silently skip the confinement
            // on every instruction after it — the fail-OPEN shape a round-17 auditor
            // named in SEAL's twin of this loop. Reaching our own index proves the
            // walk got at least this far.
            require!(seen_self, MintError::BankKeyOutsideMint);
        }
        require_keys_eq!(ctx.accounts.collection.key(), cfg.collection, MintError::WrongCollection);
        // ALL income goes to the one revenue address. The 85/15 is applied there,
        // by `split_revenue`, so every income source the project ever adds gets the
        // same treatment instead of each one re-implementing the rule.
        let (revenue, _) = Pubkey::find_program_address(&[REVENUE_SEED], &crate::ID);
        require_keys_eq!(ctx.accounts.revenue.key(), revenue, MintError::WrongTreasury);

        let now = Clock::get()?.unix_timestamp;
        require!(cfg.round_id > 0, MintError::NoRound);
        require!(now >= cfg.opens_at && now < cfg.closes_at, MintError::RoundClosed);
        require!(cfg.minted_this_round < cfg.cap, MintError::RoundCapReached);
        // THE LIFETIME CAP. `minted_total` used to be incremented and never read —
        // its own doc comment named the attack it was supposed to prevent ("a
        // governor could lift any cap by simply opening a new round") and it
        // prevented nothing, because per-round caps reset on every set_round.
        require!(cfg.minted_total < cfg.max_supply, MintError::SupplyCapReached);
        // THE LEVEL QUOTA, READ HERE AND REFUSED HERE. This is what makes "no more
        // than twelve Level V will ever exist" an on-chain invariant instead of the
        // Bank's word. It sits beside the other two ceilings deliberately: all
        // three answer the same question — may another vault of this kind exist —
        // and a cap enforced somewhere else is a cap somebody edits out.
        require!(cfg.level_minted[li] < cfg.level_caps[li], MintError::LevelCapReached);
        // ═══ THE DECK PROOF. THIS is what stops the Bank hand-picking. ═══
        //
        // The cap above bounds how many Level V can exist. It says nothing about
        // WHO gets them. Here the level must be the one the pre-committed,
        // publicly-hashed deck already assigned to THIS mint index — and the
        // index is `minted_total`, which the program owns and no caller can
        // choose. A Bank that deals off-deck cannot produce a proof; a minter who
        // wants a better level cannot change which mint number they are.
        //
        // MANDATORY, NOT OPTIONAL. Minting with no committed deck would produce a
        // vault whose level nobody can ever check against a prior commitment,
        // which is the entire property being bought.
        require!(cfg.deck_root != [0u8; 32], MintError::DeckNotCommitted);
        require!(deck_proof.len() <= MAX_DECK_PROOF, MintError::DeckProofTooLong);
        let deck_index: u32 = u32::try_from(cfg.minted_total).map_err(|_| MintError::Overflow)?;
        require!(
            deck_root_from(deck_leaf(deck_index, level), &deck_proof) == cfg.deck_root,
            MintError::BadDeckProof
        );

        require!(cfg.price_lamports <= max_price_lamports, MintError::PriceAboveMax);

        if cfg.price_lamports > 0 {
            invoke(&system_instruction::transfer(&ctx.accounts.payer.key(), &revenue, cfg.price_lamports),
                &[ctx.accounts.payer.to_account_info(), ctx.accounts.revenue.to_account_info()])?;
        }

        // The SEAL config is the CANONICAL wiring. Three programs each holding
        // their own copy can silently diverge, and then vaults mint into a
        // collection the seal program will never service (ForeignVault) — sold as
        // official, unredeemable forever. Read it, do not duplicate it.
        {
            let (expected_cfg, _) = Pubkey::find_program_address(&[SEAL_CONFIG_SEED], &SEAL_PROGRAM_ID);
            require_keys_eq!(ctx.accounts.seal_config.key(), expected_cfg, MintError::BadSealConfig);
            require_keys_eq!(*ctx.accounts.seal_config.owner, SEAL_PROGRAM_ID, MintError::BadSealConfig);
            let d = ctx.accounts.seal_config.try_borrow_data()?;
            require!(d.len() >= OFF_BANK + 32, MintError::BadSealConfig);
            require!(d[..8] == SEAL_CONFIG_DISC, MintError::BadSealConfig);
            require!(d[OFF_VERSION] == SEAL_CONFIG_VERSION, MintError::SealConfigVersion);
            let mut c = [0u8; 32]; c.copy_from_slice(&d[OFF_COLLECTION..OFF_COLLECTION + 32]);
            let mut b = [0u8; 32]; b.copy_from_slice(&d[OFF_BANK..OFF_BANK + 32]);
            require_keys_eq!(Pubkey::new_from_array(c), cfg.collection, MintError::WiringDiverged);
            require_keys_eq!(Pubkey::new_from_array(b), cfg.bank, MintError::WiringDiverged);
        }

        // A vault owned by its own asset-signer PDA is bricked forever: the owner
        // becomes a PDA that can only sign via Execute, which requires the owner.
        let (seal_pda, _) = Pubkey::find_program_address(&[SEAL_SEED], &SEAL_PROGRAM_ID);
        let mut data: Vec<u8> = vec![IX_CREATE_V2, 0];
        data.extend_from_slice(&(name.len() as u32).to_le_bytes());
        data.extend_from_slice(name.as_bytes());
        data.extend_from_slice(&(uri.len() as u32).to_le_bytes());
        data.extend_from_slice(uri.as_bytes());
        data.push(1);
        data.extend_from_slice(&2u32.to_le_bytes());
        data.push(PLUGIN_PERMANENT_FREEZE_EXECUTE);
        data.push(1); // frozen
        data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref());
        data.push(PLUGIN_ATTRIBUTES);
        // THE PROGRAM WRITES THE LEVEL, the caller never does. `level` is refused
        // from the supplied vector above, so exactly one `level` attribute exists
        // on every vault and it is this one. Written LAST so a reader scanning in
        // order meets provenance first and the level where it is always found.
        let level_name = LEVEL_NAMES[li];
        data.extend_from_slice(&((attributes.len() + 1) as u32).to_le_bytes());
        for a in attributes.iter() {
            data.extend_from_slice(&(a.key.len() as u32).to_le_bytes());
            data.extend_from_slice(a.key.as_bytes());
            data.extend_from_slice(&(a.value.len() as u32).to_le_bytes());
            data.extend_from_slice(a.value.as_bytes());
        }
        data.extend_from_slice(&(ATTR_LEVEL.len() as u32).to_le_bytes());
        data.extend_from_slice(ATTR_LEVEL.as_bytes());
        data.extend_from_slice(&(level_name.len() as u32).to_le_bytes());
        data.extend_from_slice(level_name.as_bytes());
        data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref());
        data.push(1); data.extend_from_slice(&0u32.to_le_bytes());

        let ix = Instruction {
            program_id: MPL_CORE_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.asset.key(), true),
                AccountMeta::new(ctx.accounts.collection.key(), false),
                AccountMeta::new_readonly(ctx.accounts.mint_authority.key(), true),
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new_readonly(ctx.accounts.owner.key(), false),
                AccountMeta::new_readonly(MPL_CORE_ID, false),
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                AccountMeta::new_readonly(MPL_CORE_ID, false),
            ],
            data,
        };
        invoke_signed(&ix, &[
            ctx.accounts.asset.to_account_info(),
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.mint_authority.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.mpl_core.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ], &[&[MINT_SEED, &[ctx.bumps.mint_authority]]])?;

        let c = &mut ctx.accounts.config;
        c.minted_this_round = c.minted_this_round.checked_add(1).ok_or(MintError::Overflow)?;
        c.minted_total = c.minted_total.checked_add(1).ok_or(MintError::Overflow)?;
        c.level_minted[li] = c.level_minted[li].checked_add(1).ok_or(MintError::Overflow)?;
        emit!(VaultMinted {
            asset: ctx.accounts.asset.key(),
            owner: ctx.accounts.owner.key(),
            round_id: c.round_id,
            price_lamports: c.price_lamports,
        });
        Ok(())
    }
}

#[account]
pub struct MintConfig {
    /// Layout version, FIRST field at a fixed offset. The GOV program reads this
    /// account by raw offset to snapshot the quorum divisor at proposal creation
    /// and to confirm it is named as the governance authority; without a pin, a
    /// future MINT upgrade that inserts a field would silently move what GOV
    /// thinks it is reading.
    pub version: u8,
    pub admin: Pubkey,
    pub collection: Pubkey,
    pub bank: Pubkey,
    pub governance: Pubkey,
    pub treasury: Pubkey,
    pub round_id: u32,
    pub opens_at: i64,
    pub closes_at: i64,
    pub price_lamports: u64,
    pub cap: u32,
    pub minted_this_round: u32,
    /// Never reset. `set_round` clears the per-round counter, so without this a
    /// governor could lift any cap by simply opening a new round.
    pub minted_total: u64,
    /// Hard lifetime ceiling on vaults that can ever exist. Ratchets DOWN only.
    pub max_supply: u64,
    /// The Bank's 15%. Appended AFTER max_supply on purpose: the GOV program reads
    /// this account by fixed offset, so new fields go at the end where they cannot
    /// move `governance` or `minted_total` underneath it.
    pub bank_treasury: Pubkey,
    /// Basis points of income owed to vault holders. Multiples of 100 only —
    /// NOT because the royalty plugin needs it (it writes one creator at 100%
    /// and never reads this), but because 85/15 is a promise made to holders in
    /// whole percent and 8537 bps is a number nobody agreed to.
    pub split_bps: u16,
    /// Emergency stop on the SALE only. Redemption and burn are unaffected.
    pub paused: bool,
    /// The only address SOL may be swept to for the off-chain SOL -> cbBTC swap.
    pub swap_operator: Pubkey,
    /// Always left in the revenue address so it can pay its own way.
    pub sol_reserve_lamports: u64,
    pub bump: u8,
    // ── appended in round 6. GOV reads this account at FIXED OFFSETS (governance
    //    at 105, minted_total at 205), so anything new goes at the END, past
    //    `bump`, where it cannot move a byte that another program is reading.
    /// The most SOL one `sweep_sol_for_swap` may move, enforced ON CHAIN.
    pub max_sweep_lamports: u64,
    /// The least time between two sweeps. A cap with no cooldown is not a cap.
    pub sweep_cooldown_secs: i64,
    pub last_sweep_at: i64,
    /// A governance rotation waiting out `GOVERNANCE_TIMELOCK_SECS` in public.
    /// `Pubkey::default()` means nothing is armed.
    pub pending_governance: Pubkey,
    pub pending_governance_at: i64,
    /// Notice period on a governance rotation. Ratchets UP only.
    pub governance_timelock_secs: i64,
    /// An admin rotation waiting out the same notice period, for the same reason
    /// plus one: admin holds the CANCEL on a governance rotation, so an instant
    /// admin swap would take the remedy away before it was needed.
    pub pending_admin: Pubkey,
    pub pending_admin_at: i64,
    /// The Bank co-signs every mint, so it waits out the same notice period.
    pub pending_bank: Pubkey,
    pub pending_bank_at: i64,
    /// And the swap operator, because it is where the swept SOL goes.
    pub pending_operator: Pubkey,
    pub pending_operator_at: i64,
    // ── appended for LEVELS AT MINT. Same rule as round 6: GOV reads this
    //    account at FIXED OFFSETS, so these go at the END. They spend 72 of the
    //    256 reserved CONFIG_PADDING bytes, and the padding constant drops by
    //    exactly that so the account size does not move.
    /// How many vaults may ever be minted at each level, I..V at index 0..4.
    /// The charter census is [108, 60, 36, 24, 12] = 240, denominator 732.
    /// ⚠️ THIS IS THE QUOTA, ENFORCED ON CHAIN. Without it the level is only as
    /// honest as the Bank, and "no more than twelve Level V will ever exist" is a
    /// promise rather than an invariant.
    pub level_caps: [u32; 5],
    /// How many have actually been minted at each level. ⚠️ ROUND 5 LESSON: a
    /// counter that gates NOTHING is worse than no counter — `minted_total` was
    /// written on every mint and read by nothing while its own doc comment named
    /// the attack it was meant to stop, and all eight auditors found it. This one
    /// is READ by `mint_vault` before every mint and REFUSES at the cap.
    pub level_minted: [u32; 5],
    /// Merkle root of the pre-committed, shuffled deck. Reserved here now so the
    /// account layout does not move when proof verification lands; zero means no
    /// deck is committed and nothing verifies against it yet.
    pub deck_root: [u8; 32],
    /// ═══ WHAT MAKES THE DECK A COMMITMENT RATHER THAN A PROMISE ═══
    ///
    /// `sha256(bank_salt)`, written before `deck_slot` exists. Zero means no seed
    /// has been committed and `commit_deck` will refuse.
    pub deck_salt_hash: [u8; 32],
    /// The slot whose blockhash is the seed's second half. Set by the PROGRAM as
    /// `commit_seed`'s slot + DECK_SLOT_LEAD — never supplied by a caller.
    pub deck_slot: u64,
    /// The seed itself, PUBLISHED. This is the field that removes the Bank from
    /// the trust argument: the deal is a deterministic public function of this
    /// value and `level_caps`, so any holder can recompute every vault's level
    /// and check it, with nothing left for the Bank to reveal or withhold.
    pub deck_seed: [u8; 32],
}

/// A provenance pair stamped onto the vault at creation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VaultAttribute { pub key: String, pub value: String }

#[derive(Accounts)]
pub struct Initialize<'info> {
    // 297 as before + max_sweep(8) + cooldown(8) + last_sweep(8) + pending(32) + pending_at(8)
    #[account(init, payer = admin, space = 8 + 1 + 32*5 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 32 + 8 + 1
                                          + 8 + 8 + 8 + 32 + 8 + 8 + 32 + 8 + 32 + 8 + 32 + 8
                                          + 4*5 + 4*5 + 32 + 32 + 8 + 32 + CONFIG_PADDING,
        seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateWiring<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, MintConfig>,
    pub admin: Signer<'info>,
    /// Required ONLY to rotate the treasury — the 85% is the holders' money.
    pub governance: Option<Signer<'info>>,
}

#[derive(Accounts)]
pub struct SplitRevenue<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    /// CHECK: the ["revenue"] PDA, verified in-handler.
    #[account(mut)]
    pub revenue: UncheckedAccount<'info>,
    /// CHECK: the token being split.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: ATA of the revenue PDA, verified in-handler.
    #[account(mut)]
    pub revenue_ata: UncheckedAccount<'info>,
    /// CHECK: ATA of config.treasury (the holders' 85%), verified in-handler.
    #[account(mut)]
    pub holders_ata: UncheckedAccount<'info>,
    /// CHECK: ATA of config.bank_treasury (the Bank's 15%), verified in-handler.
    #[account(mut)]
    pub bank_ata: UncheckedAccount<'info>,
    /// CHECK: SPL Token.
    #[account(address = SPL_TOKEN_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SweepSolForSwap<'info> {
    /// MUTABLE because the cooldown is stamped here; a rate limit that is not
    /// written down is not a rate limit.
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    /// CHECK: the ["revenue"] PDA, verified in-handler.
    #[account(mut)]
    pub revenue: UncheckedAccount<'info>,
    /// PINNED in config AND a SIGNER. See the note on the instruction: with a
    /// cooldown in place, an unsigned sweep is a permanent grief handle.
    #[account(mut)]
    pub swap_operator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApplyPendingGovernance<'info> {
    /// No signer: the decision was made and published a week ago.
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
}

#[derive(Accounts)]
pub struct CancelPendingGovernance<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, MintConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct CommitDeck<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, MintConfig>,
    pub admin: Signer<'info>,
    /// CHECK: pinned to the SlotHashes sysvar id inside `blockhash_of_slot`, which
    /// also bounds the count and refuses a malformed or zero entry. It is
    /// UncheckedAccount because SlotHashes is far too large for Anchor's
    /// `Sysvar<'info, _>` to deserialize, and this reads 40 bytes of it.
    pub slot_hashes: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CommitSeed<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, MintConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, MintConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetCollectionRoyalties<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, MintConfig>,
    pub admin: Signer<'info>,
    /// Changing where the holders' share goes is a holders' decision.
    #[account(constraint = governance.key() == config.governance @ MintError::TreasuryNeedsGovernance)]
    pub governance: Signer<'info>,
    /// CHECK: must equal config.collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA that signs as the collection's update authority.
    #[account(seeds = [MINT_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetRound<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = governance)]
    pub config: Account<'info, MintConfig>,
    pub governance: Signer<'info>,
}

#[derive(Accounts)]
pub struct MintVault<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    /// CHECK: new Core asset; Core initialises it.
    #[account(mut)]
    pub asset: Signer<'info>,
    /// CHECK: must equal config.collection; its update authority must be mint_authority.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// The member who will own the vault — and who MUST SIGN.
    ///
    /// A vault owned by an address nobody can sign for is unredeemable by anyone,
    /// forever: open, close and burn all require the owner's signature, and a PDA
    /// can only sign by CPI — at which point this program's instruction
    /// introspection (which sees TOP-LEVEL instructions only) can never find the
    /// matching half of a redemption. So the vault would take a real payment and a
    /// real deposit and never open again.
    ///
    /// There is NO on-chain way to test an address for this. `Pubkey::is_on_curve`
    /// is host-only: it compiles for BPF and panics `not implemented` at runtime —
    /// which is how the first version of this guard shipped past the compiler and
    /// died in the test suite. Requiring a SIGNATURE is the enforceable form of
    /// the same property, and it is the BEST AVAILABLE one — not, as this comment
    /// used to claim, a strictly stronger one.
    ///
    /// ⚠️ CORRECTED (round 14 found it, round 16 fixed the wording). `is_signer`
    /// is TRUE for a PDA passed as a CPI signer, so a program CAN satisfy this
    /// constraint and receive a vault that can never be redeemed — v5 needs two
    /// TOP-LEVEL owner signatures and a program signs only by CPI. A DAO buying a
    /// charter vault out of its Squads treasury pays, deposits real cbBTC, and
    /// gets a permanently sealed asset. Nothing on-chain can refuse it; the whole
    /// control is `unredeemable_owner` in `bank/alarm.mjs`, off-chain, at
    /// CRITICAL. Test 5.2 does NOT cover this — it passes the PDA with
    /// `isSigner:false` and is refused by `AccountNotSigner`, a different
    /// property. See the control table in SPEC.md, "THE SHIP GATE".
    ///
    /// TRADE-OFF, DELIBERATE: this makes it impossible to mint a vault FOR an
    /// absent member (bulk charter issuance to a list of addresses). If that flow
    /// is needed, it needs a different answer — not a weaker check here.
    pub owner: Signer<'info>,
    pub bank: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: THE revenue address (the ["revenue"] PDA), verified in-handler.
    ///
    /// NAMED `revenue`, not `treasury`. It was called `treasury` and that name
    /// already means something else in this program — `config.treasury` is the
    /// DISTRIBUTOR wallet that `split_revenue` pays the holders' share to. A
    /// round-8 auditor read the two as the same field and filed a CRITICAL
    /// saying distributions could never work. They were wrong, and the name was
    /// wrong enough to make them wrong.
    #[account(mut)]
    pub revenue: UncheckedAccount<'info>,
    /// CHECK: instructions sysvar, read to confine the Bank's key to this
    /// instruction. MINT had NO introspection at all until round 17.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    /// CHECK: the SEAL program's config — canonical wiring, verified in-handler.
    pub seal_config: UncheckedAccount<'info>,
    /// CHECK: PDA that signs as the collection's update authority.
    #[account(seeds = [MINT_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event] pub struct WiringUpdated { pub collection: Pubkey, pub bank: Pubkey, pub governance: Pubkey, pub treasury: Pubkey, pub bank_treasury: Pubkey, pub admin: Pubkey, pub max_supply: u64, pub split_bps: u16, pub paused: bool }
#[event] pub struct PausedChanged { pub paused: bool }
#[event] pub struct DeckCommitted { pub root: [u8; 32], pub seed: [u8; 32], pub slot: u64 }
/// The salt hash and the slot, emitted so an observer can see the commitment
/// EXISTED before the blockhash it names — which is the whole property.
#[event] pub struct DeckSeedCommitted { pub salt_hash: [u8; 32], pub slot: u64 }
#[event] pub struct GovernanceRotationArmed { pub pending: Pubkey, pub effective_at: i64 }
#[event] pub struct GovernanceRotationCancelled { pub was: Pubkey }
#[event] pub struct AdminRotationArmed { pub pending: Pubkey, pub effective_at: i64 }
#[event] pub struct AdminRotationCancelled { pub was: Pubkey }
#[event] pub struct BankRotationArmed { pub pending: Pubkey, pub effective_at: i64 }
#[event] pub struct BankRotationCancelled { pub was: Pubkey }
#[event] pub struct OperatorRotationArmed { pub pending: Pubkey, pub effective_at: i64 }
#[event] pub struct RoyaltiesSet { pub basis_points: u16, pub revenue: Pubkey }
#[event] pub struct RevenueSplit { pub mint: Pubkey, pub total: u64, pub holders: u64, pub bank: u64, pub split_bps: u16 }
#[event] pub struct SolSweptForSwap { pub amount: u64, pub operator: Pubkey, pub remaining: u64 }
#[event] pub struct RoundSet { pub round_id: u32, pub opens_at: i64, pub closes_at: i64, pub price_lamports: u64, pub cap: u32 }
#[event] pub struct VaultMinted { pub asset: Pubkey, pub owner: Pubkey, pub round_id: u32, pub price_lamports: u64 }

#[error_code]
pub enum MintError {
    #[msg("only the designated init authority may initialize")] NotTheInitAuthority,
    #[msg("the Bank must co-sign")] NotTheBank,
    #[msg("wrong collection")] WrongCollection,
    #[msg("wrong treasury")] WrongTreasury,
    #[msg("no round has been ratified yet")] NoRound,
    #[msg("the round is not open")] RoundClosed,
    #[msg("this round's cap is reached")] RoundCapReached,
    #[msg("closes_at must be after opens_at")] BadWindow,
    #[msg("vault name too long")] NameTooLong,
    #[msg("vault uri too long")] UriTooLong,
    #[msg("numeric overflow")] Overflow,
    #[msg("seal_config account is not the seal program's config")] BadSealConfig,
    #[msg("mint wiring has diverged from the seal program's config")] WiringDiverged,
    #[msg("max_supply must be non-zero, may only ratchet down, and may not fall below what is already minted")] BadSupplyCap,
    #[msg("the lifetime vault supply cap has been reached")] SupplyCapReached,
    #[msg("a round cap of zero is not an unlimited round; give a real cap")] BadCap,
    #[msg("rotating the treasury requires the governance co-signature")] TreasuryNeedsGovernance,
    #[msg("too many attributes, or an attribute string is too long")] TooManyAttributes,
    #[msg("the `redemption` and `level` attributes belong to the programs and may not be set at mint")] ReservedAttribute,
    #[msg("two attributes share a key; a map a reader takes money decisions from may not have two answers")] DuplicateAttribute,
    #[msg("the seed is already committed; a salt that can be replaced is a draw that can be repeated")] SeedAlreadyCommitted,
    #[msg("no seed has been committed, so there is no entropy to build a deck from")] SeedNotCommitted,
    #[msg("the all-zero salt hash is the not-committed sentinel and may not be committed")] BadSaltHash,
    #[msg("that salt does not hash to the committed salt hash")] BadSalt,
    #[msg("the SlotHashes sysvar account is not the sysvar, or is malformed")] BadSlotHashes,
    #[msg("the entropy slot has aged out of SlotHashes; there is deliberately no re-seed, because a re-seed is an unlimited number of draws")] DeckSlotUnavailable,
    #[msg("the level must be 1..=5 (I..V); zero is what a forgotten argument looks like and is never valid")] BadLevel,
    #[msg("that level's quota is full; the census is a hard on-chain ceiling, not a target")] LevelCapReached,
    #[msg("the level caps must each be non-zero and must not sum above max_supply")] BadLevelCaps,
    #[msg("the deck is already committed; a root that can be replaced is a deck that can be re-dealt")] DeckAlreadyCommitted,
    #[msg("the all-zero root is the not-committed sentinel and may not be committed as a deck")] BadDeckRoot,
    #[msg("no deck is committed; a level nobody can verify against a prior commitment is not a draw")] DeckNotCommitted,
    #[msg("the deck proof does not put THIS level at THIS mint index under the committed root")] BadDeckProof,
    #[msg("the deck proof is longer than any tree this supply can produce")] DeckProofTooLong,
    #[msg("the seal config is a layout version this program was not compiled against")] SealConfigVersion,
    #[msg("the round price is above the maximum this payer agreed to")] PriceAboveMax,
    #[msg("minting is paused")] MintPaused,
    #[msg("split_bps must be <= 10000 and a multiple of 100 so the royalty plugin can express it")] BadSplit,
    #[msg("there is nothing in the revenue address to split")] NothingToSplit,
    #[msg("sweep bounds out of range: cap non-zero, cooldown 1s to 7 days, SOL reserve zero or above rent exemption")] BadSweepBound,
    #[msg("this sweep is larger than the per-sweep cap in config")] SweepAboveCap,
    #[msg("the sweep cooldown has not elapsed since the last sweep")] SweepTooSoon,
    #[msg("no governance rotation is armed")] NoPendingGovernance,
    #[msg("the governance rotation timelock has not elapsed")] GovernanceTimelockActive,
    #[msg("a governance rotation to the default pubkey is not a rotation")] BadGovernanceRotation,
    #[msg("royalty basis points above the ceiling this collection allows")] BadRoyalty,
    #[msg("this sweep would breach the SOL reserve the revenue address keeps for fees")] ReserveWouldBreach,
    // ⚠️ ROUND 18: THIS MESSAGE DESCRIBED ONE OF ITS THREE EMIT SITES. Since the
    // exemption was narrowed to positional identity the same error also fires
    // when the instruction IS a mint_vault but the Bank sits outside the `bank`
    // slot — which is precisely what test 9d.4 rejects — and when the walk did
    // not reach our own index. An operator reading "is not a mint_vault" after
    // being refused for naming the Bank as PAYER of a real mint is being told
    // the wrong thing about their own transaction.
    #[msg("the Bank's key appears somewhere this instruction does not authorise: either outside the `bank` slot of a mint_vault, or in an instruction that is not a mint_vault at all. A Solana signature covers the whole transaction and the Bank does not sign for anything else")] BankKeyOutsideMint,
}
