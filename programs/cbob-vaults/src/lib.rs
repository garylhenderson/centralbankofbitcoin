//! Central Bank of Bitcoin Vaults — SEAL program (v6)
//!
//! This program owns ONE thing: the seal, and the rule that unsealing is always
//! paired with a terminal burn in the same transaction.
//!
//! A vault is a Metaplex Core asset whose `assetSigner` PDA holds the contents; a
//! `PermanentFreezeExecute` plugin gates whether anything can leave. This program
//! holds that plugin's authority, so no key anywhere can unseal a vault.
//!
//! v6 (Gary, 2026-10-03): THE PROGRAM IS THE SECOND SIGNER. There is no Bank key.
//! v5 demanded `bank: Signer` here and in BURN; v6 removes it, so the owner's
//! signature plus THIS program's rules are the whole of an unsealing. Everything
//! that stopped theft was already enforced by the programs (the seal, the
//! open<->burn pairing binding asset AND owner, the emptiness proof). What the
//! Bank added was a veto and an off-chain scan; the scan moves to the redeem
//! client as a warning. There is also no admin: the config is written once by
//! `initialize` and nothing can change it afterwards.
//!
//! v5's rule is unchanged: `open_for_redemption` refuses to thaw unless the SAME
//! TRANSACTION also contains `cbob_vault_burn::burn_vault` for the same asset and
//! owner, and there is no instruction anywhere that empties a vault and leaves it
//! alive. BURN's emptiness proof is what makes a redemption all-or-nothing.
//!
//! THE COMPLETENESS GAP. Core exposes no way to enumerate what a PDA owns, so
//! BURN can only refuse what it is SHOWN. An undeclared airdropped token or a
//! nested vault is DESTROYED by a burn. What covers that is in the control table
//! in SPEC.md, ONE place, so this comment cannot drift from what runs.
//!
//! STILL NOT AUDITED IN THIS FORM. Nothing may mint against it until it is.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};

declare_id!("9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273");

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
pub const SEAL_SEED: &[u8] = b"seal";
pub const CONFIG_SEED: &[u8] = b"config";
/// Gary's wallet (v6, 2026-10-03), which signs the one-time `initialize` and
/// nothing else in this program. `initialize` is otherwise first-come: a
/// front-runner could write the config the moment the program is deployed and
/// own it forever. A compile-time constant closes that, and unlike an
/// upgrade-authority check it is testable in BOTH directions without a live
/// upgradeable deployment — which matters, because an untested gate is not a gate.
#[cfg(not(feature = "localnet"))]
pub const INIT_AUTHORITY: Pubkey = pubkey!("Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb");
/// `--features localnet` swaps a test key in so the suite can sign.
/// `scripts/build-mainnet.sh` proves the shipped binary has Gary's key.
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
const CONFIG_PADDING: usize = 256;

/// THE BURN PROGRAM, AND THE ONE INSTRUCTION THAT MAY END A REDEMPTION.
///
/// This is a SECOND COPY of a fact that lives in another crate, which is the
/// class of defect round 5 found in BURN's reserve list. It is pinned here
/// rather than imported because BURN already depends on SEAL's config layout
/// and a Cargo dependency in the other direction would be circular.
///
/// TWO THINGS KEEP IT HONEST:
///   * `IX_BURN_VAULT_DISC` is asserted against `sha256("global:burn_vault")` in
///     the suite, and BURN's `BurnVault` account order is asserted there too.
///   * THE COUPLING FAILS CLOSED. The discriminator is derived from the
///     instruction NAME, not its account list, so a future BURN upgrade that
///     reorders accounts would keep the same discriminator and silently break
///     the `owner` binding below. If that happens the forward match FAILS, the
///     thaw is refused, and redemptions stop — the vault stays sealed with its
///     contents intact. The failure direction is a halt, never a leak.
pub const BURN_PROGRAM_ID: Pubkey = pubkey!("8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8");
/// Anchor discriminator of `cbob_vault_burn::burn_vault`.
pub const IX_BURN_VAULT_DISC: [u8; 8] = [150, 115, 145, 83, 24, 135, 83, 99];
/// Positions inside BURN's `BurnVault` account list that this program binds.
/// BURN's struct carries the matching "MUST stay account N" comments.
const BURN_IX_ASSET_IDX: usize = 0;
const BURN_IX_OWNER_IDX: usize = 2;

// Core wire format, read off instructions built by the official SDK.
const IX_UPDATE_PLUGIN_V1: u8 = 6;
const PLUGIN_PERMANENT_FREEZE_EXECUTE: u8 = 17;
const KEY_ASSET_V1: u8 = 1;
/// Anchor discriminator of `Config` = sha256("account:Config")[..8]. Pinned so a
/// future SEAL upgrade that reorders fields cannot be misread by MINT/BURN.
/// 2 since v6: `admin`, `bank` and the rotation fields are gone, so every raw
/// offset MINT and BURN read moved, and a v1 reader must refuse a v2 account.
pub const CONFIG_VERSION: u8 = 2;
/// AssetV1: key:u8 | owner[1..33] | update_authority_disc:u8[33] | collection[34..66]
const UA_DISC_COLLECTION: u8 = 2;
/// The reserve-mint token program. Every reserve mint must be owned by it — see
/// `assert_classic_spl`, which checks only the account's OWNER (not that it
/// is a mint, nor duplicates); the launch checker pins the ruled three.
pub const SPL_TOKEN_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// THE REDEMPTION CEILING, AND WHY THIS IS 3 AND NOT 8.
///
/// v5 made a redemption ONE transaction — open, every sweep, and the burn — so
/// transaction size now bounds the product, and the reserve list is
/// ADDITIVE-ONLY. Three round-13 auditors independently called this the live kill
/// switch: `MAX_RESERVE_MINTS` was 8, which is a Borsh bound and not a packet
/// bound, so one ordinary admin `update_config` could add mints until no
/// redemption fit and seal every vault that already existed, irreversibly.
/// (v6: there is no `update_config`. The list is written once, by `initialize`,
/// and this bound still guards that one write.)
///
/// MEASURED, not estimated (suite 9.14), by building the WORST-CASE LEGACY
/// transaction — every reserve swept AND closed, both ATA derivations declared,
/// and the PDA's lamports swept too, because a stranger can put lamports in any
/// vault for free (9.10) and the burn then refuses until the same transaction
/// takes them out (9.11):
///     1 mint -> 831 bytes   2 -> 975   3 -> 1119   4 -> cannot be serialized
/// 144 bytes per mint against legacy's 1232-byte limit. THREE FIT, matching
/// the protocol's three reserve assets (cbBTC, $GARY, $GIRAFFISH),
/// with 113 bytes to spare. The first version of this harness omitted the lamport
/// sweep and read 1090 — a ceiling for a vault nobody had ever griefed.
///
/// A FOURTH RESERVE MINT NEEDS A PROTOCOL CHANGE, not just a larger packet.
/// S9b lands v0 redemptions with a lookup table; v1 has a larger packet limit.
/// Neither changes this fixed reserve count or certifies a new client shape.
/// Raising this constant without re-measuring turns the suite red at 9.15/9.16:
/// the current bound preserves the measured legacy client's reserve coverage.
pub const MAX_RESERVE_MINTS: usize = 3;

#[program]
pub mod cbob_vaults {
    use super::*;

    /// One-time, and the ONLY write this config ever receives. Binds this program
    /// to the CBOB collection so a stranger cannot mint a look-alike "vault"
    /// against our globally-derivable seal PDA and have us emit authentic
    /// redemption events for Bitcoin that never existed, and fixes the reserve
    /// list for the life of the program.
    ///
    /// v6: there is no `update_config`, no rotation and no admin. The collection
    /// was never rotatable (it is stamped into every AssetV1 at mint); the Bank
    /// no longer exists; and the reserve list, which v5 let admin append to, is
    /// written here once. Production MUST pass all three reserve mints (cbBTC,
    /// $GARY, $GIRAFFISH), because nothing can add one afterwards.
    pub fn initialize(ctx: Context<Initialize>, collection: Pubkey, reserve_mints: Vec<Pubkey>) -> Result<()> {
        // AUTHORITY FIRST. It used to sit below the reserve-mint checks. Nothing
        // was writable before it either way, so this was never a hole — but it
        // made the property UNTESTABLE, which is its own problem: a probe that
        // calls this with the wrong key gets bounced by `assert_classic_spl`
        // first, and a harness reading "it rejected" as "it rejected for the
        // right reason" is exactly the false pass round 5 found three of.
        require_keys_eq!(ctx.accounts.authority.key(), INIT_AUTHORITY, VaultError::NotTheInitAuthority);

        require!(reserve_mints.len() <= MAX_RESERVE_MINTS, VaultError::TooManyReserveMints);
        // An empty reserve list would silently disable the only burn check the
        // chain can actually enforce.
        require!(!reserve_mints.is_empty(), VaultError::NoReserveMints);
        assert_classic_spl(&reserve_mints, ctx.remaining_accounts)?;

        let c = &mut ctx.accounts.config;
        c.version = CONFIG_VERSION;
        c.collection = collection;
        c.reserve_mints = reserve_mints;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Unseal a vault so its contents can be swept. REFUSES unless this same
    /// transaction also contains `cbob_vault_burn::burn_vault` for the same asset
    /// AND the same owner.
    ///
    /// THIS IS THE WHOLE RULE, IN ONE INSTRUCTION: a vault is only ever opened on
    /// its way to being destroyed. There is no close, no re-seal, and no way to
    /// end a transaction holding a thawed vault — the burn either lands or the
    /// thaw reverts with it.
    ///
    /// It also makes redemption ALL-OR-NOTHING, which the previous design did not.
    /// BURN refuses on any balance it can see, so a partial sweep cannot end the
    /// transaction: take everything, or take nothing and stay sealed. Under the
    /// close-terminated design an owner could take half and re-seal, and the
    /// half-empty vault was still transferable and sellable.
    pub fn open_for_redemption(ctx: Context<OpenForRedemption>) -> Result<()> {
        let asset = ctx.accounts.vault_asset.key();
        let owner = ctx.accounts.owner.key();
        let (asset_owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
        require_keys_eq!(asset_owner, owner, VaultError::NotTheOwner);
        // provenance: this must be one of OUR vaults
        require_keys_eq!(collection, ctx.accounts.config.collection, VaultError::ForeignVault);
        require_keys_eq!(ctx.accounts.collection.key(), collection, VaultError::WrongCollectionAccount);
        // v6: THE PROGRAM IS THE SECOND SIGNER. The owner signs (Core's Execute
        // demands it for every sweep anyway) and the rest of this function is the
        // other party. There is no Bank key to check and no Bank key to confine,
        // so v5's second walk (`BankKeyOutsidePair`) is gone with it: there is no
        // privileged signature in this transaction for a customer to spend.

        // ---- the invariant: a matching BURN must follow, in this transaction ----
        //
        // `load_instruction_at_checked` sees TOP-LEVEL instructions only, which is
        // deliberate and load-bearing in both directions:
        //   * a `burn_vault` hidden inside another program's CPI is invisible here,
        //     so it cannot satisfy this requirement;
        //   * an `open_for_redemption` reached BY a CPI reports the OUTER
        //     instruction's index, so the wrapper would need a genuine top-level
        //     burn for this exact asset and owner later in the same transaction —
        //     and BURN independently demands a genuine top-level open before it.
        //     Both halves bind asset AND owner, so neither can be borrowed from
        //     another vault's redemption sharing the transaction.
        //
        // The burn is NOT required to be the last instruction. Two redemptions may
        // share a transaction (open A, sweep A, burn A, open B, sweep B, burn B),
        // and nothing can be done with an asset after `BurnV1` closes it anyway.
        //
        // FAIL-CLOSED WALK. This loop has ONE job again, so an early stop at the
        // first `Err` can only leave `found` false and refuse the thaw. (Round 17
        // made this loop fail-open when it acquired a second job; v6 removes the
        // second job rather than relying on the `seen_self` guard that fixed it.)
        let sysvar = ctx.accounts.instructions.to_account_info();
        let current = load_current_index_checked(&sysvar)? as usize;
        let mut found = false;
        let mut i = current.checked_add(1).ok_or(VaultError::Overflow)?;
        while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
            if ix.program_id == BURN_PROGRAM_ID
                && ix.data.len() >= IX_BURN_VAULT_DISC.len()
                && ix.data[..IX_BURN_VAULT_DISC.len()] == IX_BURN_VAULT_DISC
                && ix.accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(asset)
                // bind the OWNER too, not just positional account 0
                && ix.accounts.get(BURN_IX_OWNER_IDX).map(|a| a.pubkey) == Some(owner)
            {
                found = true;
                break;
            }
            i += 1;
        }
        require!(found, VaultError::NoTerminalBurn);

        set_frozen(false, &ctx.accounts.vault_asset, &ctx.accounts.collection,
            &ctx.accounts.payer, &ctx.accounts.seal, &ctx.accounts.mpl_core,
            &ctx.accounts.system_program, ctx.bumps.seal)?;
        emit!(RedemptionOpened { asset, owner });
        Ok(())
    }

}

/// Every reserve mint MUST be a CLASSIC SPL Token mint, checked when it enters
/// the config rather than when a customer tries to redeem.
///
/// WHY: the ATA program gives every Token-2022 ATA an `ImmutableOwner` extension,
/// so its data length is 170, never 165 (measured). `burn_vault` refuses any token
/// account whose length is not exactly 165 — deliberately, because a Token-2022
/// confidential balance reads zero in the base `amount` field and we will not
/// guess. Put those two facts together and a Token-2022 reserve mint makes
/// `burn_vault` fail forever, which makes `open_for_redemption` illegal (it
/// demands a terminal burn), which seals the vault's Bitcoin permanently with no
/// recovery for either party.
///
/// THAT LANDMINE GOT WORSE IN v5, NOT BETTER. Under the close-terminated design a
/// failing reserve check blocked the close and therefore the open. It now blocks
/// the BURN, and the burn is the only exit that exists — so the reserve list is
/// the single config value that can strand every vault at once.
///
/// v5's reserve list was additive-only, so that landmine could be armed by an
/// ordinary future config change. v6 writes it exactly once, in `initialize`, and
/// refusing there turns a customer funds-loss into a failed deployment.
fn assert_classic_spl(mints: &[Pubkey], accounts: &[AccountInfo]) -> Result<()> {
    for m in mints.iter() {
        let acc = accounts.iter().find(|a| a.key() == *m).ok_or(VaultError::ReserveMintNotDeclared)?;
        require_keys_eq!(*acc.owner, SPL_TOKEN_ID, VaultError::ReserveMintNotClassicSpl);
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
    /// Layout version, FIRST field so it sits at a fixed offset (immediately
    /// after the 8-byte Anchor discriminator) no matter what is added later.
    /// MINT and BURN read this config by raw offset and refuse any version they
    /// were not compiled against — an unpinned offset read is a silent misread
    /// waiting for the next upgrade.
    pub version: u8,
    pub collection: Pubkey,
    /// The asset set every vault is activated with (cbBTC, $GARY, $GIRAFFISH).
    /// THIS IS THE CANONICAL LIST: the BURN program reads it out of this account
    /// at burn time rather than keeping its own copy, because a second copy is a
    /// copy that can silently disagree — and a burn that misses a reserve mint
    /// destroys it. Written once by `initialize`, classic SPL mints only (see
    /// `assert_classic_spl`). Unknown airdropped tokens still cannot be
    /// enumerated by any program; what covers that gap is the control table in
    /// SPEC.md, ONE place, so a claim here can never drift from what runs.
    pub reserve_mints: Vec<Pubkey>,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 1 + 32 + 4 + (32 * MAX_RESERVE_MINTS) + 1 + CONFIG_PADDING,
        seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenForRedemption<'info> {
    /// CHECK: validated as a Core AssetV1 in our collection, owned by `owner`.
    /// MUST stay account 0 — BURN's `burn_vault` matches on it to prove this
    /// transaction's thaw and its terminal burn are for the same vault.
    #[account(mut)]
    pub vault_asset: UncheckedAccount<'info>,
    /// CHECK: must equal the asset's collection; verified against config.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// MUST stay account 2 — BURN's `burn_vault` matches on it.
    pub owner: Signer<'info>,
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

#[event] pub struct RedemptionOpened { pub asset: Pubkey, pub owner: Pubkey }


#[error_code]
pub enum VaultError {
    #[msg("numeric overflow")] Overflow,
    #[msg("account is not a Metaplex Core AssetV1")] NotACoreAsset,
    #[msg("signer is not the current owner of this vault")] NotTheOwner,
    #[msg("this asset does not belong to the CBOB vault collection")] ForeignVault,
    #[msg("the collection account passed does not match the asset's collection")] WrongCollectionAccount,
    #[msg("refusing to unseal: this transaction has no terminal burn_vault for this vault and owner")] NoTerminalBurn,
    #[msg("too many reserve mints")] TooManyReserveMints,
    #[msg("reserve mint list may not be empty")] NoReserveMints,
    #[msg("only the designated init authority may initialize the config")] NotTheInitAuthority,
    #[msg("every reserve mint account must be passed so its token program can be checked")] ReserveMintNotDeclared,
    #[msg("reserve mints must be classic SPL Token mints; a Token-2022 mint would seal every vault permanently")] ReserveMintNotClassicSpl,
}
