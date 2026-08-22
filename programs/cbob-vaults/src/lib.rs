//! Central Bank of Bitcoin Vaults — SEAL program (v4)
//!
//! Mint and burn now live in SEPARATE programs with their own upgrade authorities,
//! so a governor-driven mint change never re-touches the program guarding the
//! Bitcoin. This program owns ONE thing: the seal, and the rule that unsealing is
//! always paired with a terminal close.
//! ==================================
//! Seal authority for CBOBTC vaults. A vault is a Metaplex Core asset whose
//! `assetSigner` PDA holds the contents; a `PermanentFreezeExecute` plugin gates
//! whether anything can leave. This program holds that plugin's authority, so no
//! key anywhere can unseal a vault.
//!
//! WHAT CHANGED IN v2, AND WHY
//! ---------------------------
//! v1 was reviewed by five independent auditors across four model families and
//! failed. The defect that mattered:
//!
//!     v1 burned a vault when `asset_signer.lamports() == 0`.
//!
//! cbBTC does not live in the PDA's lamports — it lives in a TOKEN ACCOUNT OWNED
//! BY the PDA, whose rent sits in the token account. A vault holding a whole
//! Bitcoin reads zero lamports. v1 classified it empty and burned it, and the
//! token account became permanently unsignable. It was reproduced on a validator
//! as a two-instruction transaction, and as a ONE-instruction transaction.
//!
//! Core gives no way to enumerate what a PDA owns, so that check can never be made
//! correct. v2 therefore does not try:
//!
//!   * `close_redemption` NEVER burns. It always re-seals.
//!   * Burning is a separate, explicitly-invoked `burn_empty_vault`, which
//!     verifies everything it actually can and refuses on anything it cannot.
//!
//! A vault that outlives its contents is an accounting nuisance. A burn that
//! outlives its contents is a customer's Bitcoin deleted with their own signature
//! on it. v2 takes the first trade every time.
//!
//! STILL NOT AUDITED IN THIS FORM. Nothing may mint against it until it is.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};

declare_id!("9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273");

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
pub const EXECUTE_PREFIX: &[u8] = b"mpl-core-execute";
pub const SEAL_SEED: &[u8] = b"seal";
pub const CONFIG_SEED: &[u8] = b"config";
/// ⚠️ SET THIS TO THE SQUADS MULTISIG BEFORE THE MAINNET BUILD.
/// `initialize` is otherwise first-come: a front-runner could set themselves as
/// admin the moment the program is deployed and own the config forever. A
/// compile-time constant closes that, and unlike an upgrade-authority check it is
/// testable in BOTH directions without a live upgradeable deployment — which
/// matters, because an untested gate is not a gate.
pub const INIT_AUTHORITY: Pubkey = pubkey!("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");

// Core wire format, read off instructions built by the official SDK.
const IX_CREATE_V2: u8 = 20;
const IX_UPDATE_PLUGIN_V1: u8 = 6;
const IX_BURN_V1: u8 = 12;
const PLUGIN_PERMANENT_FREEZE_EXECUTE: u8 = 17;
const PLUGIN_ATTRIBUTES: u8 = 6;
const KEY_ASSET_V1: u8 = 1;
/// PluginAuthority::Address, read off an SDK-built CreateV2.
const PLUGIN_AUTHORITY_ADDRESS: u8 = 3;
const MAX_NAME_LEN: usize = 64;
const MAX_URI_LEN: usize = 200;
/// AssetV1: key:u8 | owner[1..33] | update_authority_disc:u8[33] | collection[34..66]
const UA_DISC_COLLECTION: u8 = 2;
/// SPL token account: mint[0..32] | owner[32..64] | amount[64..72]
/// SPL token account: mint[0..32] owner[32..64] amount[64..72]
/// delegate:COption<Pubkey>[72..108] state[108] is_native[109..121]
/// delegated_amount[121..129] close_authority:COption<Pubkey>[129..165]
const TOKEN_ACCOUNT_LEN: usize = 165;
pub const SPL_TOKEN_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const SPL_TOKEN_2022_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ATA_PROGRAM_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const MAX_RESERVE_MINTS: usize = 8;

#[program]
pub mod cbob_vaults {
    use super::*;

    /// One-time. Binds this program to the CBOB collection so a stranger cannot
    /// mint a look-alike "vault" against our globally-derivable seal PDA and have
    /// us emit authentic redemption events for Bitcoin that never existed.
    pub fn initialize(ctx: Context<Initialize>, collection: Pubkey, bank: Pubkey, reserve_mints: Vec<Pubkey>) -> Result<()> {
        require!(reserve_mints.len() <= MAX_RESERVE_MINTS, VaultError::TooManyReserveMints);
        // An empty reserve list would silently disable the only burn check the
        // chain can actually enforce.
        require!(!reserve_mints.is_empty(), VaultError::NoReserveMints);

        require_keys_eq!(ctx.accounts.admin.key(), INIT_AUTHORITY, VaultError::NotTheInitAuthority);

        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.collection = collection;
        c.bank = bank;
        c.reserve_mints = reserve_mints;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Rotate the Bank co-signer (or the collection). Admin only. A lost Bank key
    /// halts redemptions until this is called — that is the deliberate cost of
    /// making the Bank a real party rather than a rule.
    /// NOTE: `collection` is deliberately NOT rotatable. It is stamped into every
    /// AssetV1 header at mint, so changing it would strand every existing vault
    /// behind `ForeignVault` with its BTC sealed and no way back.
    pub fn update_config(ctx: Context<UpdateConfig>, bank: Option<Pubkey>, admin: Option<Pubkey>, reserve_mints: Option<Vec<Pubkey>>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(x) = bank { c.bank = x; }
        if let Some(x) = admin { c.admin = x; }
        if let Some(x) = reserve_mints {
            require!(x.len() <= MAX_RESERVE_MINTS, VaultError::TooManyReserveMints);
            require!(!x.is_empty(), VaultError::NoReserveMints);
            for old in c.reserve_mints.iter() { require!(x.contains(old), VaultError::ReserveMintDropped); }
            c.reserve_mints = x;
        }
        Ok(())
    }


    /// Unseal a vault so its contents can be swept. REFUSES unless this same
    /// transaction also contains `close_redemption` for the same asset AND the
    /// same owner.
    pub fn open_for_redemption(ctx: Context<OpenForRedemption>) -> Result<()> {
        let asset = ctx.accounts.vault_asset.key();
        let owner = ctx.accounts.owner.key();
        let (asset_owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
        require_keys_eq!(asset_owner, owner, VaultError::NotTheOwner);
        // provenance: this must be one of OUR vaults
        require_keys_eq!(collection, ctx.accounts.config.collection, VaultError::ForeignVault);
        require_keys_eq!(ctx.accounts.collection.key(), collection, VaultError::WrongCollectionAccount);
        // TRUE 2-of-2: the Bank must co-sign every unsealing, and the owner must
        // sign too. Neither party can move a member's contents alone — the Bank is
        // not the owner (Core's Execute demands the owner's signature) and the
        // owner cannot unseal without us.
        require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.config.bank, VaultError::NotTheBank);

        // ---- the invariant: a matching close must follow, in this transaction ----
        let sysvar = ctx.accounts.instructions.to_account_info();
        let current = load_current_index_checked(&sysvar)? as usize;
        let want = crate::instruction::CloseRedemption::DISCRIMINATOR;
        let mut found = false;
        let mut i = current + 1;
        while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
            if ix.program_id == crate::ID
                && ix.data.len() >= want.len()
                && ix.data[..want.len()] == *want
                && ix.accounts.first().map(|a| a.pubkey) == Some(asset)
                // bind the OWNER too, not just positional account 0
                && ix.accounts.get(2).map(|a| a.pubkey) == Some(owner)
            {
                found = true;
                break;
            }
            i += 1;
        }
        require!(found, VaultError::NoTerminalClose);

        set_frozen(false, &ctx.accounts.vault_asset, &ctx.accounts.collection,
            &ctx.accounts.payer, &ctx.accounts.seal, &ctx.accounts.mpl_core,
            &ctx.accounts.system_program, ctx.bumps.seal)?;
        emit!(RedemptionOpened { asset, owner });
        Ok(())
    }

    /// Terminal half. ALWAYS re-seals — it never burns, at any lamport balance.
    /// It also stamps the asset so a vault that was opened is visibly no longer
    /// pristine, which is what stops a drained vault being resold as a full one.
    pub fn close_redemption(ctx: Context<CloseRedemption>) -> Result<()> {
        let asset = ctx.accounts.vault_asset.key();
        let (asset_owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
        require_keys_eq!(asset_owner, ctx.accounts.owner.key(), VaultError::NotTheOwner);
        require_keys_eq!(collection, ctx.accounts.config.collection, VaultError::ForeignVault);
        require_keys_eq!(ctx.accounts.collection.key(), collection, VaultError::WrongCollectionAccount);
        // The Bank co-signs the CLOSE as well as the open. A Solana signature covers
        // the WHOLE transaction, so this is what lets the Bank see — and refuse —
        // every inner instruction in a redemption, including a non-ATA token account
        // being created or a delegate being approved. Without it the 2-of-2 is
        // nominal: the Bank authorises a thaw and never sees what happened inside it.
        require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.config.bank, VaultError::NotTheBank);

        // Close is the terminal half of a redemption, not a standalone instruction.
        // Without this, owner+Bank could stamp `redemption: opened` onto a pristine
        // vault and destroy its provenance without ever unsealing it.
        {
            let sysvar = ctx.accounts.instructions.to_account_info();
            let current = load_current_index_checked(&sysvar)? as usize;
            let want = crate::instruction::OpenForRedemption::DISCRIMINATOR;
            let mut found = false;
            for i in 0..current {
                if let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
                    if ix.program_id == crate::ID
                        && ix.data.len() >= want.len()
                        && ix.data[..want.len()] == *want
                        && ix.accounts.first().map(|a| a.pubkey) == Some(asset)
                    { found = true; break; }
                }
            }
            require!(found, VaultError::NoPrecedingOpen);
        }

        // Re-sealing must not leave a durable Token authority behind that outlives
        // the seal. This is what makes the 2-of-2 real rather than nominal.
        inspect_reserves(&ctx.accounts.config, &ctx.accounts.asset_signer.key(),
            ctx.remaining_accounts, false)?;

        set_frozen(true, &ctx.accounts.vault_asset, &ctx.accounts.collection,
            &ctx.accounts.payer, &ctx.accounts.seal, &ctx.accounts.mpl_core,
            &ctx.accounts.system_program, ctx.bumps.seal)?;
        mark_opened(&ctx.accounts.vault_asset, &ctx.accounts.collection,
            &ctx.accounts.payer, &ctx.accounts.seal, &ctx.accounts.mpl_core,
            &ctx.accounts.system_program, ctx.bumps.seal)?;

        emit!(RedemptionClosed { asset, lamports_left: ctx.accounts.asset_signer.lamports() });
        Ok(())
    }

}

/// Inspect every reserve mint's token account (both token-program derivations).
///
/// This exists because of two findings a second audit round produced:
///   * a DELEGATE approved during the thaw window survives the re-seal, and the
///     Token program will honour it later with no Execute, no Bank and no thaw —
///     draining a vault that still looks sealed and full. Same for a transferred
///     `owner` or a `close_authority`.
///   * an account that merely holds lamports at the derived address (anyone can
///     send 1 lamport there) is NOT a token account, and must be skipped rather
///     than treated as a malformed one, or a stranger can permanently block a
///     vault from ever being burned for the cost of one lamport.
fn inspect_reserves(
    config: &Config,
    pda: &Pubkey,
    remaining: &[AccountInfo],
    require_empty: bool,
) -> Result<()> {
    for mint in config.reserve_mints.iter() {
        for token_program in [SPL_TOKEN_ID, SPL_TOKEN_2022_ID] {
            let (expected, _) = Pubkey::find_program_address(
                &[pda.as_ref(), token_program.as_ref(), mint.as_ref()],
                &ATA_PROGRAM_ID,
            );
            let acc = remaining
                .iter()
                .find(|a| a.key() == expected)
                .ok_or(VaultError::ReserveNotDeclared)?;
            // not a token account at all -> nothing can be hidden in it
            if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
            let d = acc.try_borrow_data()?;
            if d.len() < TOKEN_ACCOUNT_LEN { continue; }

            let mut o = [0u8; 32]; o.copy_from_slice(&d[32..64]);
            require_keys_eq!(Pubkey::new_from_array(o), *pda, VaultError::ReserveNotOurs);
            // a delegate, or a close authority, outlives the seal
            require!(d[72..76] == [0, 0, 0, 0], VaultError::ReserveDelegated);
            require!(d[121..129] == [0u8; 8], VaultError::ReserveDelegated);
            require!(d[129..133] == [0, 0, 0, 0], VaultError::ReserveDelegated);
            // Token-2022 extensions (len > base) can hold value the base `amount`
            // does not show — confidential balances read zero. Refuse to reason
            // about them rather than guess.
            require!(d.len() == TOKEN_ACCOUNT_LEN, VaultError::ReserveHasExtensions);
            if require_empty {
                let mut amt = [0u8; 8]; amt.copy_from_slice(&d[64..72]);
                require!(u64::from_le_bytes(amt) == 0, VaultError::VaultNotEmpty);
            }
        }
    }
    Ok(())
}

/// Returns (owner, collection). Validates the account really is a Core AssetV1
/// belonging to a collection. Both callers inherit the ownership check — in v1 only
/// `open` had it and `close` did not, which was an accidental asymmetry.
fn read_core_asset(asset: &UncheckedAccount) -> Result<(Pubkey, Pubkey)> {
    require_keys_eq!(*asset.owner, MPL_CORE_ID, VaultError::NotACoreAsset);
    let data = asset.try_borrow_data()?;
    require!(data.len() >= 66 && data[0] == KEY_ASSET_V1, VaultError::NotACoreAsset);
    require!(data[33] == UA_DISC_COLLECTION, VaultError::ForeignVault);
    let mut o = [0u8; 32]; o.copy_from_slice(&data[1..33]);
    let mut c = [0u8; 32]; c.copy_from_slice(&data[34..66]);
    Ok((Pubkey::new_from_array(o), Pubkey::new_from_array(c)))
}

/// The ONLY place that can move the seal. Keep it that way.
#[allow(clippy::too_many_arguments)]
fn set_frozen<'info>(
    frozen: bool,
    asset: &UncheckedAccount<'info>,
    collection: &UncheckedAccount<'info>,
    payer: &Signer<'info>,
    seal: &UncheckedAccount<'info>,
    mpl_core: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    seal_bump: u8,
) -> Result<()> {
    core_plugin_cpi(
        vec![IX_UPDATE_PLUGIN_V1, PLUGIN_PERMANENT_FREEZE_EXECUTE, u8::from(frozen)],
        asset, collection, payer, seal, mpl_core, system_program, seal_bump)
}

/// Stamp `redemption: opened` onto the asset, so a vault that has been unsealed
/// once is visibly not pristine. Requires the vault to be minted with an
/// `Attributes` plugin delegated to the seal PDA — see MINT-REQUIREMENTS in SPEC.
#[allow(clippy::too_many_arguments)]
fn mark_opened<'info>(
    asset: &UncheckedAccount<'info>,
    collection: &UncheckedAccount<'info>,
    payer: &Signer<'info>,
    seal: &UncheckedAccount<'info>,
    mpl_core: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    seal_bump: u8,
) -> Result<()> {
    // Plugin::Attributes { attribute_list: [ { key: "redemption", value: "opened" } ] }
    let mut data = vec![IX_UPDATE_PLUGIN_V1, PLUGIN_ATTRIBUTES];
    data.extend_from_slice(&1u32.to_le_bytes());
    let k = b"redemption"; let v = b"opened";
    data.extend_from_slice(&(k.len() as u32).to_le_bytes()); data.extend_from_slice(k);
    data.extend_from_slice(&(v.len() as u32).to_le_bytes()); data.extend_from_slice(v);
    core_plugin_cpi(data, asset, collection, payer, seal, mpl_core, system_program, seal_bump)
}

#[allow(clippy::too_many_arguments)]
fn core_plugin_cpi<'info>(
    data: Vec<u8>,
    asset: &UncheckedAccount<'info>,
    collection: &UncheckedAccount<'info>,
    payer: &Signer<'info>,
    seal: &UncheckedAccount<'info>,
    mpl_core: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    seal_bump: u8,
) -> Result<()> {
    let ix = Instruction {
        program_id: MPL_CORE_ID,
        accounts: vec![
            AccountMeta::new(asset.key(), false),
            AccountMeta::new(collection.key(), false),
            AccountMeta::new(payer.key(), true),
            AccountMeta::new_readonly(seal.key(), true),
            AccountMeta::new_readonly(system_program.key(), false),
            AccountMeta::new_readonly(MPL_CORE_ID, false),
        ],
        data,
    };
    invoke_signed(&ix, &[
        asset.to_account_info(), collection.to_account_info(), payer.to_account_info(),
        seal.to_account_info(), system_program.to_account_info(), mpl_core.to_account_info(),
    ], &[&[SEAL_SEED, &[seal_bump]]])?;
    Ok(())
}


#[account]
pub struct Config {
    pub admin: Pubkey,
    pub collection: Pubkey,
    pub bank: Pubkey,
    /// The asset set every vault is activated with (cbBTC, $GARY, $GIRAFFISH).
    /// `burn_empty_vault` REQUIRES each of these to be declared and empty, which
    /// makes "burn a vault still holding the reserve" impossible on-chain rather
    /// than merely discouraged. Unknown airdropped tokens still cannot be
    /// enumerated by any program — that gap is covered by the Bank co-signature
    /// and the off-chain scanner, and is stated plainly rather than papered over.
    pub reserve_mints: Vec<Pubkey>,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + 32 + 32 + 32 + 4 + (32 * MAX_RESERVE_MINTS) + 1, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenForRedemption<'info> {
    /// CHECK: validated as a Core AssetV1 in our collection, owned by `owner`.
    #[account(mut)]
    pub vault_asset: UncheckedAccount<'info>,
    /// CHECK: must equal the asset's collection; verified against config.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    pub owner: Signer<'info>,
    /// The Bank's co-signature. Required for every unsealing.
    pub bank: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: PDA holding the PermanentFreezeExecute authority.
    #[account(seeds = [SEAL_SEED], bump)]
    pub seal: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    /// CHECK: instructions sysvar, read for introspection.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseRedemption<'info> {
    /// CHECK: MUST stay account 0 — `open_for_redemption` matches on it.
    #[account(mut)]
    pub vault_asset: UncheckedAccount<'info>,
    /// CHECK: must equal the asset's collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: MUST stay account 2 — `open_for_redemption` matches on it.
    pub owner: Signer<'info>,
    /// The Bank's co-signature on the terminal half, so it signs the whole tx.
    pub bank: Signer<'info>,
    /// CHECK: instructions sysvar — close verifies a preceding open.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    /// CHECK: Core's asset-signer PDA — the vault itself.
    #[account(mut, seeds = [EXECUTE_PREFIX, vault_asset.key().as_ref()], bump, seeds::program = MPL_CORE_ID)]
    pub asset_signer: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: seal authority PDA.
    #[account(seeds = [SEAL_SEED], bump)]
    pub seal: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}


#[event] pub struct RedemptionOpened { pub asset: Pubkey, pub owner: Pubkey }
#[event] pub struct RedemptionClosed { pub asset: Pubkey, pub lamports_left: u64 }

#[error_code]
pub enum VaultError {
    #[msg("account is not a Metaplex Core AssetV1")] NotACoreAsset,
    #[msg("signer is not the current owner of this vault")] NotTheOwner,
    #[msg("this asset does not belong to the CBOB vault collection")] ForeignVault,
    #[msg("the collection account passed does not match the asset's collection")] WrongCollectionAccount,
    #[msg("refusing to unseal: this transaction has no terminal close_redemption for this vault and owner")] NoTerminalClose,
    #[msg("this vault still holds another vault; release the inner vaults first")] VaultStillHoldsAVault,
    #[msg("the vault is not empty — refusing to burn")] VaultNotEmpty,
    #[msg("declared account count does not match the accounts provided")] DeclarationMismatch,
    #[msg("the Bank must co-sign this operation")] NotTheBank,
    #[msg("too many reserve mints")] TooManyReserveMints,
    #[msg("reserve mint list may not be empty")] NoReserveMints,
    #[msg("a reserve mint may not be dropped once configured")] ReserveMintDropped,
    #[msg("close_redemption requires a preceding open_for_redemption for this vault")] NoPrecedingOpen,
    #[msg("only the designated init authority may initialize the config")] NotTheInitAuthority,
    #[msg("vault name too long")] NameTooLong,
    #[msg("vault uri too long")] UriTooLong,
    #[msg("every reserve mint's token account must be declared")] ReserveNotDeclared,
    #[msg("a reserve token account is not owned by this vault")] ReserveNotOurs,
    #[msg("a reserve token account has a delegate or close authority that would outlive the seal")] ReserveDelegated,
    #[msg("a reserve token account carries Token-2022 extensions; refusing to reason about hidden balances")] ReserveHasExtensions,
}
