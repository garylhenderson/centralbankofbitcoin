//! Central Bank of Bitcoin Vaults — SEAL program (v5)
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
//! WHAT CHANGED IN v5, AND WHY — THE BURN IS NOW THE TERMINAL INSTRUCTION
//! ----------------------------------------------------------------------
//! Gary's rule, 2026-08-22: *"THE ONLY WAY to break open a vault is to burn it."*
//!
//! v2-v4 were the exact inverse of that. `close_redemption` was the terminal
//! half: open -> sweep -> close, and the vault SURVIVED, empty, carrying a
//! `redemption: opened` stamp. Two things followed that the business cannot
//! accept:
//!
//!   * a drained vault stayed transferable and sellable, and a buyer's entire
//!     stated basis is "this vault still contains its reserve";
//!   * a PARTIAL sweep was legal — take half, re-seal, resell — because close
//!     never asked what was left.
//!
//! v5 keeps every check and moves which instruction ends the sentence:
//!
//!   * `open_for_redemption` refuses to thaw unless the SAME TRANSACTION also
//!     contains `cbob_vault_burn::burn_vault` for the same asset and owner.
//!   * `close_redemption` IS GONE. There is no instruction anywhere that empties
//!     a vault and leaves it alive.
//!   * BURN's emptiness proof is UNCHANGED. It is now satisfied by a sweep in
//!     the same transaction rather than by a previous one — which is what makes
//!     the redemption all-or-nothing: sweep everything the proof can see, or the
//!     burn refuses and the thaw reverts with it.
//!
//! WHAT THIS DOES NOT CHANGE, AND WHY IT MATTERS MORE NOW
//! -----------------------------------------------------
//! v1's defect is still the reason BURN is a separate program with its own key:
//!
//!     v1 burned a vault when `asset_signer.lamports() == 0`.
//!
//! cbBTC does not live in the PDA's lamports — it lives in a TOKEN ACCOUNT OWNED
//! BY the PDA, whose rent sits in the token account. A vault holding a whole
//! Bitcoin reads zero lamports. v1 classified it empty and burned it, and the
//! token account became permanently unsignable.
//!
//! Core exposes no way to enumerate what a PDA owns, so BURN can only refuse what
//! it is SHOWN. Under v2-v4 an undeclared airdropped token or a nested asset was
//! STRANDED by a burn. Under v5, where every redemption ends in a burn, that same
//! gap DESTROYS it — Core's `BurnV1` does not sweep the asset-signer PDA and
//! nothing can ever sign for it again. The gap did not widen; the consequence
//! did.
//!
//! ⚠️ WHAT ACTUALLY COVERS IT, AS OPPOSED TO WHAT IS USUALLY CLAIMED:
//!   * `bank/alarm.mjs` reports a NESTED VAULT every pass (`detectNestedVaults`,
//!     free — DAS already returns the owner) and an UNDECLARED TOKEN ACCOUNT in
//!     the daily `--reconcile`. Both are PERIODIC and POST-HOC.
//!   * The Bank's co-signature could refuse in the moment — a Solana signature
//!     covers the whole transaction, so the Bank sees every instruction — but
//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
//!     signs, because nothing signs. Until that is built, the pre-signature
//!     control is a human procedure, not a control.
//! Written this way deliberately: the previous draft of this comment asserted a
//! scan-before-signing gate that does not exist anywhere, which is the same shape
//! as the round-6 finding where BURN's header promised a reconcile no file called.
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
/// The CBOBTC Squads multisig (set 2026-08-22), off-curve, signs by CPI.
/// `initialize` is otherwise first-come: a front-runner could set themselves as
/// admin the moment the program is deployed and own the config forever. A
/// compile-time constant closes that, and unlike an upgrade-authority check it is
/// testable in BOTH directions without a live upgradeable deployment — which
/// matters, because an untested gate is not a gate.
#[cfg(not(feature = "localnet"))]
pub const INIT_AUTHORITY: Pubkey = pubkey!("bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1");
/// A Squads vault cannot sign locally; `--features localnet` swaps a test key in.
/// `scripts/build-mainnet.sh` proves the shipped binary has the Squads key.
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
pub const CONFIG_VERSION: u8 = 1;
/// AssetV1: key:u8 | owner[1..33] | update_authority_disc:u8[33] | collection[34..66]
const UA_DISC_COLLECTION: u8 = 2;
/// The reserve-mint token program. Every reserve mint must be owned by it — see
/// `assert_classic_spl`, which is the only thing in this program that still
/// reads a token account, and it reads the MINT, never a balance.
pub const SPL_TOKEN_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// THE REDEMPTION CEILING, AND WHY THIS IS 3 AND NOT 8.
///
/// v5 made a redemption ONE transaction — open, every sweep, and the burn — so
/// transaction size now bounds the product, and the reserve list is
/// ADDITIVE-ONLY. Three round-13 auditors independently called this the live kill
/// switch: `MAX_RESERVE_MINTS` was 8, which is a Borsh bound and not a packet
/// bound, so one ordinary admin `update_config` could add mints until no
/// redemption fit and seal every vault that already existed, irreversibly.
///
/// MEASURED, not estimated (suite 9.14), by building the real transaction:
///     1 mint -> 802 bytes   2 -> 946   3 -> 1090   4 -> cannot be serialized
/// 144 bytes per mint against a 1232-byte packet. THREE IS THE MAXIMUM, and it is
/// exactly the three reserve assets the business has (cbBTC, $GARY, $GIRAFFISH),
/// with 142 bytes to spare.
///
/// A FOURTH RESERVE MINT IS NOT A CONFIG CHANGE. It requires a versioned
/// transaction with an address lookup table, a redemption client that builds one,
/// and a measurement proving it lands — none of which exist. Raising this constant
/// without re-measuring turns the suite red at 9.15/9.16, which is the point:
/// the number is tied to the measurement rather than to anyone's arithmetic.
pub const MAX_RESERVE_MINTS: usize = 3;

/// How long a Bank or admin rotation sits in public before it takes effect.
/// ⚠️ THE DEPLOYED VALUE IS THIS CONSTANT — unlike MINT's, it is not configurable,
/// because SEAL has no instruction that needs a short one to be testable: the
/// suite exercises the ARM, the REFUSAL and the CANCEL, and the apply path is
/// the same three lines in both programs.
const ROTATION_NOTICE_SECS: i64 = 7 * 24 * 3600;

#[program]
pub mod cbob_vaults {
    use super::*;

    /// One-time. Binds this program to the CBOB collection so a stranger cannot
    /// mint a look-alike "vault" against our globally-derivable seal PDA and have
    /// us emit authentic redemption events for Bitcoin that never existed.
    pub fn initialize(ctx: Context<Initialize>, collection: Pubkey, bank: Pubkey, reserve_mints: Vec<Pubkey>) -> Result<()> {
        // AUTHORITY FIRST. It used to sit below the reserve-mint checks. Nothing
        // was writable before it either way, so this was never a hole — but it
        // made the property UNTESTABLE, which is its own problem: a probe that
        // calls this with the wrong key gets bounced by `assert_classic_spl`
        // first, and a harness reading "it rejected" as "it rejected for the
        // right reason" is exactly the false pass round 5 found three of.
        require_keys_eq!(ctx.accounts.admin.key(), INIT_AUTHORITY, VaultError::NotTheInitAuthority);

        require!(reserve_mints.len() <= MAX_RESERVE_MINTS, VaultError::TooManyReserveMints);
        // An empty reserve list would silently disable the only burn check the
        // chain can actually enforce.
        require!(!reserve_mints.is_empty(), VaultError::NoReserveMints);
        assert_classic_spl(&reserve_mints, ctx.remaining_accounts)?;

        let c = &mut ctx.accounts.config;
        c.version = CONFIG_VERSION;
        c.admin = ctx.accounts.admin.key();
        c.collection = collection;
        c.bank = bank;
        c.reserve_mints = reserve_mints;
        c.bump = ctx.bumps.config;
        c.pending_bank = Pubkey::default();
        c.pending_bank_at = 0;
        c.pending_admin = Pubkey::default();
        c.pending_admin_at = 0;
        Ok(())
    }

    /// Rotate the Bank co-signer (or the collection). Admin only. A lost Bank key
    /// halts redemptions until this is called — that is the deliberate cost of
    /// making the Bank a real party rather than a rule.
    /// NOTE: `collection` is deliberately NOT rotatable. It is stamped into every
    /// AssetV1 header at mint, so changing it would strand every existing vault
    /// behind `ForeignVault` with its BTC sealed and no way back.
    pub fn update_config(ctx: Context<UpdateConfig>, bank: Option<Pubkey>, admin: Option<Pubkey>, reserve_mints: Option<Vec<Pubkey>>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.config;
        // THE BANK AND THE ADMIN WAIT. Round 7 gave MINT a notice period on both
        // and stopped there, and this is the program whose whole claim is TRUE
        // 2-of-2 — one admin signature set `config.bank` to an attacker key in a
        // single transaction, and the Bank's refusal is what stops a seller
        // planting a delegate on a reserve ATA during a thaw and then selling the
        // vault. The only control left was drift detection up to thirty minutes
        // later, after the Bitcoin was gone. Admin waits too, because admin holds
        // the cancel: an instant admin swap takes the remedy away first.
        if let Some(x) = bank {
            require_keys_neq!(x, Pubkey::default(), VaultError::NotTheBank);
            c.pending_bank = x;
            c.pending_bank_at = now.checked_add(ROTATION_NOTICE_SECS).ok_or(VaultError::Overflow)?;
            emit!(SealRotationArmed { what: 1, pending: x, effective_at: c.pending_bank_at });
        }
        if let Some(x) = admin {
            require_keys_neq!(x, Pubkey::default(), VaultError::NotTheAdmin);
            c.pending_admin = x;
            c.pending_admin_at = now.checked_add(ROTATION_NOTICE_SECS).ok_or(VaultError::Overflow)?;
            emit!(SealRotationArmed { what: 2, pending: x, effective_at: c.pending_admin_at });
        }
        if let Some(x) = reserve_mints {
            require!(x.len() <= MAX_RESERVE_MINTS, VaultError::TooManyReserveMints);
            require!(!x.is_empty(), VaultError::NoReserveMints);
            for old in c.reserve_mints.iter() { require!(x.contains(old), VaultError::ReserveMintDropped); }
            assert_classic_spl(&x, ctx.remaining_accounts)?;
            c.reserve_mints = x;
        }
        Ok(())
    }

    /// Land a rotation the notice period has released. Permissionless: the value
    /// was published days ago and there is nothing left to choose.
    pub fn apply_pending(ctx: Context<ApplyPending>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.config;
        let mut did = false;
        if c.pending_bank != Pubkey::default() && now >= c.pending_bank_at {
            c.bank = c.pending_bank; c.pending_bank = Pubkey::default(); c.pending_bank_at = 0; did = true;
        }
        if c.pending_admin != Pubkey::default() && now >= c.pending_admin_at {
            c.admin = c.pending_admin; c.pending_admin = Pubkey::default(); c.pending_admin_at = 0; did = true;
        }
        require!(did, VaultError::NothingPending);
        emit!(SealRotationApplied { bank: c.bank, admin: c.admin });
        Ok(())
    }

    /// Disarm both. The CURRENT admin, which is the point of the notice period.
    pub fn cancel_pending(ctx: Context<UpdateConfig>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require!(c.pending_bank != Pubkey::default() || c.pending_admin != Pubkey::default(),
            VaultError::NothingPending);
        c.pending_bank = Pubkey::default(); c.pending_bank_at = 0;
        c.pending_admin = Pubkey::default(); c.pending_admin_at = 0;
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
        // TRUE 2-of-2: the Bank must co-sign every unsealing, and the owner must
        // sign too. Neither party can move a member's contents alone — the Bank is
        // not the owner (Core's Execute demands the owner's signature) and the
        // owner cannot unseal without us.
        require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.config.bank, VaultError::NotTheBank);

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
        let sysvar = ctx.accounts.instructions.to_account_info();
        let current = load_current_index_checked(&sysvar)? as usize;
        let mut found = false;
        let mut i = current + 1;
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
/// The reserve list is additive-only by design, so that landmine would be armed
/// by an ordinary future config change. Refusing at config time turns a customer
/// funds-loss into an admin error message.
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
    pub admin: Pubkey,
    pub collection: Pubkey,
    pub bank: Pubkey,
    /// The asset set every vault is activated with (cbBTC, $GARY, $GIRAFFISH).
    /// THIS IS THE CANONICAL LIST: the BURN program reads it out of this account
    /// at burn time rather than keeping its own copy, because a second copy is a
    /// copy that can silently disagree — and a burn that misses a reserve mint
    /// destroys it. `close_redemption` requires each of these to be declared and
    /// free of a delegate or close authority. Additions only, never removals, and
    /// classic SPL mints only (see `assert_classic_spl`). Unknown airdropped
    /// tokens still cannot be enumerated by any program — that gap is covered by
    /// the Bank co-signature and the off-chain scanner, stated plainly rather
    /// than papered over.
    pub reserve_mints: Vec<Pubkey>,
    /// Rotations waiting out `ROTATION_NOTICE_SECS`. `Pubkey::default()` means
    /// nothing is armed. Declared AFTER `reserve_mints` deliberately: MINT and
    /// BURN read this account at fixed offsets that all sit BEFORE the Vec.
    pub pending_bank: Pubkey,
    pub pending_bank_at: i64,
    pub pending_admin: Pubkey,
    pub pending_admin_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    // + pending_bank(32) + at(8) + pending_admin(32) + at(8)
    #[account(init, payer = admin, space = 8 + 1 + 32 + 32 + 32 + 4 + (32 * MAX_RESERVE_MINTS) + 1
                                          + 32 + 8 + 32 + 8 + CONFIG_PADDING,
        seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
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
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct ApplyPending<'info> {
    /// No signer: the values were published and the only question is the clock.
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}


#[event] pub struct RedemptionOpened { pub asset: Pubkey, pub owner: Pubkey }

#[event] pub struct SealRotationArmed { pub what: u8, pub pending: Pubkey, pub effective_at: i64 }
#[event] pub struct SealRotationApplied { pub bank: Pubkey, pub admin: Pubkey }

#[error_code]
pub enum VaultError {
    #[msg("numeric overflow")] Overflow,
    #[msg("a rotation to the default pubkey is not a rotation")] NotTheAdmin,
    #[msg("no rotation is armed, or its notice period has not elapsed")] NothingPending,
    #[msg("account is not a Metaplex Core AssetV1")] NotACoreAsset,
    #[msg("signer is not the current owner of this vault")] NotTheOwner,
    #[msg("this asset does not belong to the CBOB vault collection")] ForeignVault,
    #[msg("the collection account passed does not match the asset's collection")] WrongCollectionAccount,
    #[msg("refusing to unseal: this transaction has no terminal burn_vault for this vault and owner")] NoTerminalBurn,
    #[msg("the Bank must co-sign this operation")] NotTheBank,
    #[msg("too many reserve mints")] TooManyReserveMints,
    #[msg("reserve mint list may not be empty")] NoReserveMints,
    #[msg("a reserve mint may not be dropped once configured")] ReserveMintDropped,
    #[msg("only the designated init authority may initialize the config")] NotTheInitAuthority,
    #[msg("every reserve mint account must be passed so its token program can be checked")] ReserveMintNotDeclared,
    #[msg("reserve mints must be classic SPL Token mints; a Token-2022 mint would seal every vault permanently")] ReserveMintNotClassicSpl,
}
