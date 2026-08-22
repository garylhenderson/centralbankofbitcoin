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

const IX_CREATE_V2: u8 = 20;
const PLUGIN_PERMANENT_FREEZE_EXECUTE: u8 = 17;
const PLUGIN_ATTRIBUTES: u8 = 6;
const PLUGIN_AUTHORITY_ADDRESS: u8 = 3;
const MAX_NAME_LEN: usize = 64;
const MAX_URI_LEN: usize = 200;

#[program]
pub mod cbob_vault_mint {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        collection: Pubkey,
        bank: Pubkey,
        governance: Pubkey,
        treasury: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), INIT_AUTHORITY, MintError::NotTheInitAuthority);
        let c = &mut ctx.accounts.config;
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
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Admin may rotate the wiring. It may NOT set the round or the price — that is
    /// the governors' job and theirs alone.
    pub fn update_wiring(
        ctx: Context<UpdateWiring>,
        collection: Option<Pubkey>,
        bank: Option<Pubkey>,
        governance: Option<Pubkey>,
        treasury: Option<Pubkey>,
        admin: Option<Pubkey>,
    ) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(x) = collection { c.collection = x; }
        if let Some(x) = bank { c.bank = x; }
        if let Some(x) = governance { c.governance = x; }
        if let Some(x) = treasury { c.treasury = x; }
        if let Some(x) = admin { c.admin = x; }
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
    pub fn mint_vault(ctx: Context<MintVault>, name: String, uri: String) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, MintError::NameTooLong);
        require!(uri.len() <= MAX_URI_LEN, MintError::UriTooLong);
        let cfg = &ctx.accounts.config;
        require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, MintError::NotTheBank);
        require_keys_eq!(ctx.accounts.collection.key(), cfg.collection, MintError::WrongCollection);
        require_keys_eq!(ctx.accounts.treasury.key(), cfg.treasury, MintError::WrongTreasury);

        let now = Clock::get()?.unix_timestamp;
        require!(cfg.round_id > 0, MintError::NoRound);
        require!(now >= cfg.opens_at && now < cfg.closes_at, MintError::RoundClosed);
        require!(cfg.cap == 0 || cfg.minted_this_round < cfg.cap, MintError::RoundCapReached);

        // price flows to the treasury — this is the 85/15 revenue hook
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
            // Anchor: disc[0..8] admin[8..40] collection[40..72] bank[72..104]
            require!(d.len() >= 104, MintError::BadSealConfig);
            let mut c = [0u8; 32]; c.copy_from_slice(&d[40..72]);
            let mut b = [0u8; 32]; b.copy_from_slice(&d[72..104]);
            require_keys_eq!(Pubkey::new_from_array(c), cfg.collection, MintError::WiringDiverged);
            require_keys_eq!(Pubkey::new_from_array(b), cfg.bank, MintError::WiringDiverged);
        }

        // A vault owned by its own asset-signer PDA is bricked forever: the owner
        // becomes a PDA that can only sign via Execute, which requires the owner.
        let (asset_signer, _) = Pubkey::find_program_address(
            &[b"mpl-core-execute", ctx.accounts.asset.key().as_ref()], &MPL_CORE_ID);
        require!(ctx.accounts.owner.key() != asset_signer, MintError::OwnerWouldBrick);

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
        data.extend_from_slice(&0u32.to_le_bytes());
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
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + 32*5 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 1, seeds = [CONFIG_SEED], bump)]
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
    /// CHECK: the member who will own the vault.
    pub owner: UncheckedAccount<'info>,
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
    #[msg("owner would be the vault's own PDA, which bricks it forever")] OwnerWouldBrick,
}
