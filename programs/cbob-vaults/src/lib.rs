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
    program::invoke_signed,
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};

declare_id!("9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273");

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
pub const EXECUTE_PREFIX: &[u8] = b"mpl-core-execute";
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

// Core wire format, read off instructions built by the official SDK.
const IX_UPDATE_PLUGIN_V1: u8 = 6;
const PLUGIN_PERMANENT_FREEZE_EXECUTE: u8 = 17;
const PLUGIN_ATTRIBUTES: u8 = 6;
const KEY_ASSET_V1: u8 = 1;
const KEY_PLUGIN_HEADER_V1: u8 = 3;
const KEY_PLUGIN_REGISTRY_V1: u8 = 4;
/// PluginAuthority::Address, read off an SDK-built CreateV2.
const PLUGIN_AUTHORITY_ADDRESS: u8 = 3;
/// Bounds on the attribute list we are willing to parse and rewrite. A vault
/// whose attributes exceed these fails CLOSED (the redemption reverts and the
/// vault stays sealed) rather than silently losing provenance.
const MAX_ATTRS: usize = 16;
const MAX_ATTR_STR: usize = 128;
/// Anchor discriminator of `Config` = sha256("account:Config")[..8]. Pinned so a
/// future SEAL upgrade that reorders fields cannot be misread by MINT/BURN.
pub const CONFIG_VERSION: u8 = 1;
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
/// The one attribute key this program owns. Everything else on the asset is
/// somebody else's and is preserved verbatim.
pub const ATTR_REDEMPTION: &str = "redemption";
pub const ATTR_OPENED: &str = "opened";

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
            ctx.remaining_accounts)?;

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

/// Every reserve mint MUST be a CLASSIC SPL Token mint, checked when it enters
/// the config rather than when a customer tries to redeem.
///
/// WHY: the ATA program gives every Token-2022 ATA an `ImmutableOwner` extension,
/// so its data length is 170, never 165 (measured). `inspect_reserves` and
/// `burn_vault` both refuse any token account whose length is not exactly 165 —
/// deliberately, because a Token-2022 confidential balance reads zero in the base
/// `amount` field and we will not guess. Put those two facts together and a
/// Token-2022 reserve mint makes `close_redemption` fail forever, which makes
/// `open_for_redemption` illegal (it demands a terminal close), which seals the
/// vault's Bitcoin permanently with no recovery for either party.
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
            // Length is exactly 165 for a classic SPL account; `assert_classic_spl`
            // keeps Token-2022 mints out of the reserve set entirely, so this can
            // only fire on something malformed.
            require!(d.len() == TOKEN_ACCOUNT_LEN, VaultError::ReserveHasExtensions);
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

/// Read the asset's CURRENT Attributes list.
///
/// WHY THIS EXISTS: Core's `UpdatePluginV1` REPLACES a plugin's data outright.
/// The previous version wrote a one-pair list, so the first redemption of a
/// charter vault would have erased the Notice serial and Governor standing that
/// the business says is the only surviving record of charter membership (the
/// Proof-of-Burn token and the Notice are both destroyed at redemption). No
/// attacker was needed — the happy path did it.
///
/// Returns an empty list when the asset carries no Attributes plugin.
fn read_attributes(asset: &UncheckedAccount) -> Result<Vec<(String, String)>> {
    let d = asset.try_borrow_data()?;
    let rd32 = |o: usize| -> Result<u32> {
        require!(o + 4 <= d.len(), VaultError::MalformedAsset);
        Ok(u32::from_le_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]]))
    };
    // ---- walk the base AssetV1 record to find the plugin header ----
    let mut o = 1usize + 32; // key + owner
    require!(o < d.len(), VaultError::MalformedAsset);
    match d[o] { 0 => o += 1, 1 | 2 => o += 33, _ => return err!(VaultError::MalformedAsset) };
    for _ in 0..2 { // name, uri
        let n = rd32(o)? as usize;
        o = o.checked_add(4 + n).ok_or(VaultError::MalformedAsset)?;
    }
    require!(o < d.len(), VaultError::MalformedAsset);
    let seq = d[o]; o += 1;
    if seq == 1 { o += 8; }
    // no plugin header at all -> no attributes
    if o + 9 > d.len() || d[o] != KEY_PLUGIN_HEADER_V1 { return Ok(vec![]); }
    o += 1;
    let mut off = [0u8; 8]; off.copy_from_slice(&d[o..o + 8]);
    let mut p = u64::from_le_bytes(off) as usize;
    // ---- the plugin registry ----
    require!(p < d.len() && d[p] == KEY_PLUGIN_REGISTRY_V1, VaultError::MalformedAsset);
    p += 1;
    let n = rd32(p)? as usize; p += 4;
    require!(n <= 32, VaultError::MalformedAsset);
    for _ in 0..n {
        require!(p < d.len(), VaultError::MalformedAsset);
        let ptype = d[p]; p += 1;
        require!(p < d.len(), VaultError::MalformedAsset);
        let auth = d[p]; p += 1;
        if auth == PLUGIN_AUTHORITY_ADDRESS { p += 32; }
        require!(p + 8 <= d.len(), VaultError::MalformedAsset);
        let mut po = [0u8; 8]; po.copy_from_slice(&d[p..p + 8]); p += 8;
        if ptype != PLUGIN_ATTRIBUTES { continue; }
        // ---- Plugin::Attributes { attribute_list: Vec<Attribute> } ----
        let mut q = u64::from_le_bytes(po) as usize;
        require!(q < d.len() && d[q] == PLUGIN_ATTRIBUTES, VaultError::MalformedAsset);
        q += 1;
        let cnt = rd32(q)? as usize; q += 4;
        require!(cnt <= MAX_ATTRS, VaultError::TooManyAttributes);
        let mut out = Vec::with_capacity(cnt);
        for _ in 0..cnt {
            let mut pair: [String; 2] = [String::new(), String::new()];
            for slot in pair.iter_mut() {
                let l = rd32(q)? as usize; q += 4;
                require!(l <= MAX_ATTR_STR, VaultError::TooManyAttributes);
                require!(q + l <= d.len(), VaultError::MalformedAsset);
                *slot = String::from_utf8(d[q..q + l].to_vec())
                    .map_err(|_| error!(VaultError::MalformedAsset))?;
                q += l;
            }
            let [k, v] = pair;
            out.push((k, v));
        }
        return Ok(out);
    }
    Ok(vec![])
}

/// Stamp `redemption: opened` onto the asset, so a vault that has been unsealed
/// once is visibly not pristine — PRESERVING every other attribute already on it.
/// Requires the vault to be minted with an `Attributes` plugin delegated to the
/// seal PDA — see MINT-REQUIREMENTS in SPEC.
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
    // Plugin::Attributes { attribute_list: <everything already there> + redemption }
    let existing = read_attributes(asset)?;
    let mut list: Vec<(String, String)> = existing
        .into_iter()
        .filter(|(k, _)| k != ATTR_REDEMPTION)
        .collect();
    require!(list.len() < MAX_ATTRS, VaultError::TooManyAttributes);
    list.push((ATTR_REDEMPTION.to_string(), ATTR_OPENED.to_string()));

    let mut data = vec![IX_UPDATE_PLUGIN_V1, PLUGIN_ATTRIBUTES];
    data.extend_from_slice(&(list.len() as u32).to_le_bytes());
    for (k, v) in list.iter() {
        data.extend_from_slice(&(k.len() as u32).to_le_bytes()); data.extend_from_slice(k.as_bytes());
        data.extend_from_slice(&(v.len() as u32).to_le_bytes()); data.extend_from_slice(v.as_bytes());
    }
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
                                          + 32 + 8 + 32 + 8, seeds = [CONFIG_SEED], bump)]
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

#[derive(Accounts)]
pub struct ApplyPending<'info> {
    /// No signer: the values were published and the only question is the clock.
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}


#[event] pub struct RedemptionOpened { pub asset: Pubkey, pub owner: Pubkey }
#[event] pub struct RedemptionClosed { pub asset: Pubkey, pub lamports_left: u64 }

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
    #[msg("refusing to unseal: this transaction has no terminal close_redemption for this vault and owner")] NoTerminalClose,
    #[msg("the Bank must co-sign this operation")] NotTheBank,
    #[msg("too many reserve mints")] TooManyReserveMints,
    #[msg("reserve mint list may not be empty")] NoReserveMints,
    #[msg("a reserve mint may not be dropped once configured")] ReserveMintDropped,
    #[msg("close_redemption requires a preceding open_for_redemption for this vault")] NoPrecedingOpen,
    #[msg("only the designated init authority may initialize the config")] NotTheInitAuthority,
    #[msg("every reserve mint's token account must be declared")] ReserveNotDeclared,
    #[msg("a reserve token account is not owned by this vault")] ReserveNotOurs,
    #[msg("a reserve token account has a delegate or close authority that would outlive the seal")] ReserveDelegated,
    #[msg("a reserve token account carries Token-2022 extensions; refusing to reason about hidden balances")] ReserveHasExtensions,
    #[msg("the asset account could not be parsed as a Core AssetV1 with plugins")] MalformedAsset,
    #[msg("this vault carries more attributes than this program will rewrite; refusing rather than dropping provenance")] TooManyAttributes,
    #[msg("every reserve mint account must be passed so its token program can be checked")] ReserveMintNotDeclared,
    #[msg("reserve mints must be classic SPL Token mints; a Token-2022 mint would seal every vault permanently")] ReserveMintNotClassicSpl,
}
