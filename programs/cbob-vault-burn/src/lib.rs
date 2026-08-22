//! CBOB Vault BURN — separate program, separate upgrade authority, one job.
//!
//! Burning is the ONLY path that destroys value, so it lives alone and is never a
//! side effect of anything. v1 burned a vault whenever the PDA's own lamports were
//! zero — but cbBTC lives in a TOKEN ACCOUNT owned by that PDA, so a vault holding
//! a whole Bitcoin reads zero. It destroyed the Bitcoin. That is why this is its
//! own program with its own key.
//!
//! WHAT THIS CAN AND CANNOT PROVE — stated plainly, because the previous version
//! shipped a burn that LOOKED like a proof:
//!   * CAN prove: PDA lamports are zero; every reserve mint's ATA (both token
//!     programs) is declared, PDA-owned, undelegated and empty; no declared account
//!     is a live Core asset (a nested vault).
//!   * CANNOT prove: completeness. Core exposes no way to enumerate the token
//!     accounts a PDA owns, so a NON-ATA account holding value and simply not
//!     declared is invisible here. That gap is covered by the Bank's co-signature
//!     — a Solana signature covers the whole transaction, so the Bank sees every
//!     instruction — plus the off-chain scanner, which uses getTokenAccountsByOwner
//!     and DOES see non-ATA accounts. The Bank must alarm on every burn.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};

declare_id!("8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8");

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
pub const SPL_TOKEN_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const SPL_TOKEN_2022_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ATA_PROGRAM_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
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
pub const CONFIG_SEED: &[u8] = b"burn-config";
pub const SEAL_PROGRAM_ID: Pubkey = pubkey!("9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273");
pub const SEAL_CONFIG_SEED: &[u8] = b"config";
/// SEAL's `Config` layout, PINNED. See the same constants in MINT.
pub const SEAL_CONFIG_DISC: [u8; 8] = [155, 12, 170, 224, 30, 250, 204, 130];
pub const SEAL_CONFIG_VERSION: u8 = 1;
const OFF_VERSION: usize = 8;
const OFF_COLLECTION: usize = 41;
const OFF_BANK: usize = 73;
const OFF_RESERVES: usize = 105;
pub const EXECUTE_PREFIX: &[u8] = b"mpl-core-execute";

const IX_BURN_V1: u8 = 12;
const KEY_ASSET_V1: u8 = 1;
const UA_DISC_COLLECTION: u8 = 2;
const TOKEN_ACCOUNT_LEN: usize = 165;
const MAX_RESERVE_MINTS: usize = 8;

#[program]
pub mod cbob_vault_burn {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, collection: Pubkey, bank: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), INIT_AUTHORITY, BurnError::NotTheInitAuthority);
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.collection = collection;
        c.bank = bank;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// `collection` is deliberately NOT rotatable — it is stamped into every vault at
    /// mint, and changing it would strand every existing vault.
    pub fn update_config(ctx: Context<UpdateConfig>, bank: Option<Pubkey>, admin: Option<Pubkey>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(x) = bank { c.bank = x; }
        if let Some(x) = admin { c.admin = x; }
        Ok(())
    }

    /// Destroy a vault. Owner AND Bank must sign — the Bank because this is the one
    /// instruction that can permanently remove value, so it must alarm on every call.
    pub fn burn_vault(ctx: Context<BurnVault>, declared: u8) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, BurnError::NotTheBank);
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
        require_keys_eq!(collection, cfg.collection, BurnError::ForeignVault);
        require_keys_eq!(ctx.accounts.collection.key(), collection, BurnError::WrongCollectionAccount);

        // Canonical wiring lives in the SEAL config — INCLUDING THE RESERVE LIST.
        //
        // This program used to keep its OWN copy of reserve_mints and cross-check
        // only `collection` and `bank`, while its header claimed the cross-check
        // prevented "a trimmed reserve list". It did not. Adding a mint to SEAL and
        // forgetting to add it here (two separate admin acts) left that mint never
        // derived, never required and never checked — so a vault holding it burned
        // cleanly and the token was destroyed. The list is now read from one place
        // and cannot diverge, because there is no second copy to diverge from.
        let reserves: Vec<Pubkey> = {
            let (expected_cfg, _) = Pubkey::find_program_address(&[SEAL_CONFIG_SEED], &SEAL_PROGRAM_ID);
            require_keys_eq!(ctx.accounts.seal_config.key(), expected_cfg, BurnError::BadSealConfig);
            require_keys_eq!(*ctx.accounts.seal_config.owner, SEAL_PROGRAM_ID, BurnError::BadSealConfig);
            let d = ctx.accounts.seal_config.try_borrow_data()?;
            require!(d.len() >= OFF_RESERVES + 4, BurnError::BadSealConfig);
            require!(d[..8] == SEAL_CONFIG_DISC, BurnError::BadSealConfig);
            require!(d[OFF_VERSION] == SEAL_CONFIG_VERSION, BurnError::SealConfigVersion);
            let mut c = [0u8; 32]; c.copy_from_slice(&d[OFF_COLLECTION..OFF_COLLECTION + 32]);
            let mut b = [0u8; 32]; b.copy_from_slice(&d[OFF_BANK..OFF_BANK + 32]);
            require_keys_eq!(Pubkey::new_from_array(c), cfg.collection, BurnError::WiringDiverged);
            require_keys_eq!(Pubkey::new_from_array(b), cfg.bank, BurnError::WiringDiverged);
            let n = u32::from_le_bytes([d[OFF_RESERVES], d[OFF_RESERVES + 1], d[OFF_RESERVES + 2], d[OFF_RESERVES + 3]]) as usize;
            require!(n > 0 && n <= MAX_RESERVE_MINTS, BurnError::NoReserveMints);
            require!(d.len() >= OFF_RESERVES + 4 + n * 32, BurnError::BadSealConfig);
            (0..n).map(|i| {
                let o = OFF_RESERVES + 4 + i * 32;
                let mut k = [0u8; 32]; k.copy_from_slice(&d[o..o + 32]);
                Pubkey::new_from_array(k)
            }).collect()
        };

        require!(ctx.accounts.asset_signer.lamports() == 0, BurnError::VaultNotEmpty);
        require!(ctx.remaining_accounts.len() == declared as usize, BurnError::DeclarationMismatch);

        let pda = ctx.accounts.asset_signer.key();
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
                    // The reserve loop refuses Token-2022 extensions because a
                    // confidential balance reads zero in the base `amount`. This
                    // loop did not, so a NON-reserve T22 token with extensions
                    // could pass the emptiness proof holding real value.
                    require!(d.len() == TOKEN_ACCOUNT_LEN, BurnError::ReserveHasExtensions);
                    let mut amt = [0u8; 8]; amt.copy_from_slice(&d[64..72]);
                    require!(u64::from_le_bytes(amt) == 0, BurnError::VaultNotEmpty);
                }
            }
        }

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
        invoke(&ix, &[
            ctx.accounts.vault_asset.to_account_info(),
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.mpl_core.to_account_info(),
        ])?;
        emit!(VaultBurned { asset: ctx.accounts.vault_asset.key(), owner: asset_owner, declared_accounts: declared });
        Ok(())
    }
}

#[account]
/// NOTE: no `reserve_mints` here on purpose. The reserve set is read from the
/// SEAL config at burn time so the two can never disagree.
pub struct BurnConfig { pub admin: Pubkey, pub collection: Pubkey, pub bank: Pubkey, pub bump: u8 }

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + 32*3 + 1, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, BurnConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, BurnConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct BurnVault<'info> {
    /// CHECK: validated as a Core AssetV1 in our collection, owned by `owner`.
    #[account(mut)]
    pub vault_asset: UncheckedAccount<'info>,
    /// CHECK: must equal the asset's collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    pub owner: Signer<'info>,
    /// The Bank co-signs every destruction, and must alarm on it.
    pub bank: Signer<'info>,
    /// CHECK: Core's asset-signer PDA — the vault itself.
    #[account(mut, seeds = [EXECUTE_PREFIX, vault_asset.key().as_ref()], bump, seeds::program = MPL_CORE_ID)]
    pub asset_signer: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, BurnConfig>,
    /// CHECK: the SEAL program's config — canonical wiring, verified in-handler.
    pub seal_config: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event] pub struct VaultBurned { pub asset: Pubkey, pub owner: Pubkey, pub declared_accounts: u8 }

#[error_code]
pub enum BurnError {
    #[msg("only the designated init authority may initialize")] NotTheInitAuthority,
    #[msg("the Bank must co-sign every burn")] NotTheBank,
    #[msg("account is not a Metaplex Core AssetV1")] NotACoreAsset,
    #[msg("signer is not the current owner")] NotTheOwner,
    #[msg("this asset does not belong to the CBOB vault collection")] ForeignVault,
    #[msg("the collection account does not match the asset's collection")] WrongCollectionAccount,
    #[msg("the vault is not empty — refusing to burn")] VaultNotEmpty,
    #[msg("this vault still holds another vault")] VaultStillHoldsAVault,
    #[msg("declared account count does not match accounts provided")] DeclarationMismatch,
    #[msg("every reserve mint's token account must be declared")] ReserveNotDeclared,
    #[msg("a reserve token account is not owned by this vault")] ReserveNotOurs,
    #[msg("a reserve token account has a delegate or close authority")] ReserveDelegated,
    #[msg("a reserve token account carries Token-2022 extensions")] ReserveHasExtensions,
    #[msg("reserve mint list may not be empty")] NoReserveMints,
    #[msg("too many reserve mints")] TooManyReserveMints,
    #[msg("the seal config is a layout version this program was not compiled against")] SealConfigVersion,
    #[msg("seal_config account is not the seal program's config")] BadSealConfig,
    #[msg("burn wiring has diverged from the seal program's config")] WiringDiverged,
}
