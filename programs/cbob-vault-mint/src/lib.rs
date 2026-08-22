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
};

declare_id!("Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo");

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
/// The SEAL PROGRAM. Its `["seal"]` PDA is DERIVED at runtime, never hardcoded —
/// a stale constant would embed a plugin authority the seal program cannot sign,
/// and every vault minted with it would be born permanently frozen with its BTC
/// unreachable by ANY party. Derive it, do not copy it.
pub const SEAL_PROGRAM_ID: Pubkey = pubkey!("9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273");
pub const SEAL_SEED: &[u8] = b"seal";
pub const SEAL_CONFIG_SEED: &[u8] = b"config";
/// ⚠️ SET TO THE SQUADS MULTISIG BEFORE THE MAINNET BUILD.
pub const INIT_AUTHORITY: Pubkey = pubkey!("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");
pub const CONFIG_SEED: &[u8] = b"mint-config";
/// Signs CreateV2 as the collection's update authority, so nothing but this
/// program can put an asset into the CBOB collection.
pub const MINT_SEED: &[u8] = b"mint";

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
/// A round may not run longer than this. `closes_at = i64::MAX` was expressible.
const MAX_ROUND_SECS: i64 = 365 * 24 * 3600;

#[program]
pub mod cbob_vault_mint {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        collection: Pubkey,
        bank: Pubkey,
        governance: Pubkey,
        treasury: Pubkey,
        max_supply: u64,
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), INIT_AUTHORITY, MintError::NotTheInitAuthority);
        // There is no "unlimited" sentinel. A supply cap that can be expressed as
        // zero is a supply cap that will be zero by accident.
        require!(max_supply > 0, MintError::BadSupplyCap);
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
        c.bump = ctx.bumps.config;
        emit!(WiringUpdated { collection, bank, governance, treasury, admin: c.admin, max_supply });
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
    ) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(x) = treasury {
            let gov = ctx.accounts.governance.as_ref().ok_or(MintError::TreasuryNeedsGovernance)?;
            require_keys_eq!(gov.key(), c.governance, MintError::TreasuryNeedsGovernance);
            c.treasury = x;
        }
        if let Some(x) = max_supply {
            require!(x > 0 && x <= c.max_supply, MintError::BadSupplyCap);
            require!(x >= c.minted_total, MintError::BadSupplyCap);
            c.max_supply = x;
        }
        if let Some(x) = bank { c.bank = x; }
        if let Some(x) = governance { c.governance = x; }
        if let Some(x) = admin { c.admin = x; }
        emit!(WiringUpdated { collection: c.collection, bank: c.bank, governance: c.governance,
            treasury: c.treasury, admin: c.admin, max_supply: c.max_supply });
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
        require!(closes_at - opens_at <= MAX_ROUND_SECS, MintError::BadWindow);
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

    /// Mint a vault. The plugin set is fixed here; governance cannot touch it.
    /// `max_price_lamports` is the payer's slippage guard. `set_round` can reprice
    /// instantly, so without it a governor can raise the price between a buyer
    /// simulating and their transaction landing, and the buyer pays whatever the
    /// config says at execution time. The payer states their own ceiling.
    pub fn mint_vault(ctx: Context<MintVault>, name: String, uri: String, max_price_lamports: u64, attributes: Vec<VaultAttribute>) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, MintError::NameTooLong);
        require!(uri.len() <= MAX_URI_LEN, MintError::UriTooLong);
        // Provenance (Notice serial, Governor standing) is stamped HERE and nowhere
        // else. Once the Proof-of-Burn token is burned and the Notice retired at
        // redemption, the vault is the only record that a holder was charter.
        require!(attributes.len() <= MAX_ATTRS, MintError::TooManyAttributes);
        for a in attributes.iter() {
            require!(a.key.len() <= MAX_ATTR_STR && a.value.len() <= MAX_ATTR_STR, MintError::TooManyAttributes);
            require!(!a.key.is_empty(), MintError::TooManyAttributes);
            // SEAL owns this key. Letting MINT pre-set it would let a vault be born
            // already claiming to have been redeemed.
            require!(a.key != ATTR_REDEMPTION, MintError::ReservedAttribute);
        }
        let cfg = &ctx.accounts.config;
        require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, MintError::NotTheBank);
        require_keys_eq!(ctx.accounts.collection.key(), cfg.collection, MintError::WrongCollection);
        require_keys_eq!(ctx.accounts.treasury.key(), cfg.treasury, MintError::WrongTreasury);

        let now = Clock::get()?.unix_timestamp;
        require!(cfg.round_id > 0, MintError::NoRound);
        require!(now >= cfg.opens_at && now < cfg.closes_at, MintError::RoundClosed);
        require!(cfg.minted_this_round < cfg.cap, MintError::RoundCapReached);
        // THE LIFETIME CAP. `minted_total` used to be incremented and never read —
        // its own doc comment named the attack it was supposed to prevent ("a
        // governor could lift any cap by simply opening a new round") and it
        // prevented nothing, because per-round caps reset on every set_round.
        require!(cfg.minted_total < cfg.max_supply, MintError::SupplyCapReached);

        require!(cfg.price_lamports <= max_price_lamports, MintError::PriceAboveMax);

        // price flows to the treasury — this is the 85/15 revenue hook.
        // NOTE: the 85/15 SPLIT ITSELF IS NOT ON-CHAIN. 100% of the price lands in
        // one treasury account and the split is an off-chain promise. Stated here
        // rather than implied, because three auditors read the comment as if the
        // program enforced it.
        if cfg.price_lamports > 0 {
            invoke(
                &system_instruction::transfer(
                    &ctx.accounts.payer.key(),
                    &ctx.accounts.treasury.key(),
                    cfg.price_lamports,
                ),
                &[ctx.accounts.payer.to_account_info(), ctx.accounts.treasury.to_account_info()],
            )?;
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
        data.extend_from_slice(&(attributes.len() as u32).to_le_bytes());
        for a in attributes.iter() {
            data.extend_from_slice(&(a.key.len() as u32).to_le_bytes());
            data.extend_from_slice(a.key.as_bytes());
            data.extend_from_slice(&(a.value.len() as u32).to_le_bytes());
            data.extend_from_slice(a.value.as_bytes());
        }
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
    /// account by raw offset to learn live supply and confirm it is named as the
    /// governance authority; without a pin, a future MINT upgrade that inserts a
    /// field would silently move what GOV thinks it is reading.
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
    pub bump: u8,
}

/// A provenance pair stamped onto the vault at creation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VaultAttribute { pub key: String, pub value: String }

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + 1 + 32*5 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 1, seeds = [CONFIG_SEED], bump)]
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
    /// the same property, and it is strictly stronger: it proves someone actually
    /// holds the key today, rather than that the address merely could exist.
    ///
    /// TRADE-OFF, DELIBERATE: this makes it impossible to mint a vault FOR an
    /// absent member (bulk charter issuance to a list of addresses). If that flow
    /// is needed, it needs a different answer — not a weaker check here.
    pub owner: Signer<'info>,
    pub bank: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: receives the round price.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
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

#[event] pub struct WiringUpdated { pub collection: Pubkey, pub bank: Pubkey, pub governance: Pubkey, pub treasury: Pubkey, pub admin: Pubkey, pub max_supply: u64 }
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
    #[msg("owner is an off-curve address (a PDA); such a vault could never be redeemed by anyone")] OwnerWouldBrick,
    #[msg("max_supply must be non-zero, may only ratchet down, and may not fall below what is already minted")] BadSupplyCap,
    #[msg("the lifetime vault supply cap has been reached")] SupplyCapReached,
    #[msg("a round cap of zero is not an unlimited round; give a real cap")] BadCap,
    #[msg("rotating the treasury requires the governance co-signature")] TreasuryNeedsGovernance,
    #[msg("too many attributes, or an attribute string is too long")] TooManyAttributes,
    #[msg("the `redemption` attribute belongs to the seal program and may not be set at mint")] ReservedAttribute,
    #[msg("the seal config is a layout version this program was not compiled against")] SealConfigVersion,
    #[msg("the round price is above the maximum this payer agreed to")] PriceAboveMax,
}
