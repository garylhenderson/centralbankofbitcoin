//! CBOB Vault BURN — separate program, separate upgrade authority, one job.
//!
//! Burning is the ONLY path that destroys value, so it lives alone and is never a
//! side effect of anything. v1 burned a vault whenever the PDA's own lamports were
//! zero — but cbBTC lives in a TOKEN ACCOUNT owned by that PDA, so a vault holding
//! a whole Bitcoin reads zero. It destroyed the Bitcoin. That is why this is its
//! own program with its own key.
//!
//! v5: THE BURN IS THE TERMINAL INSTRUCTION OF EVERY REDEMPTION.
//!
//! Gary's rule, 2026-08-22: *"THE ONLY WAY to break open a vault is to burn it."*
//! `close_redemption` is gone from SEAL. `burn_vault` now REFUSES unless the same
//! transaction already contains SEAL's `open_for_redemption` for the same asset
//! and the same owner, and SEAL refuses to thaw unless this instruction follows.
//! Sweep and burn are one transaction or neither happens.
//!
//! NOT ONE LINE OF THE EMPTINESS PROOF BELOW CHANGED. It used to be satisfied by
//! a sweep in a PREVIOUS transaction; it is now satisfied by a sweep in THIS one.
//! That is the whole difference, and it is what makes a redemption all-or-nothing:
//! anything the proof can still see refuses the burn, and the thaw reverts with it.
//!
//! THE CONSEQUENCE OF THE COMPLETENESS GAP CHANGED, THOUGH, AND IT GOT WORSE.
//! Under the old design an undeclared airdropped token or a nested asset survived
//! a burn, stranded behind a PDA. It still does — but now every redemption ends
//! here, so that is the normal exit rather than an optional extra step, and Core's
//! `BurnV1` does not sweep the asset-signer PDA. Read the paragraph below as a
//! statement about DESTROYED value, not stranded value.
//!
//! ⚠️ AND READ "the Bank must alarm on every burn" AS EXACTLY THAT — an alarm,
//! AFTER the fact. `bank/alarm.mjs` now reports a nested vault every pass and an
//! undeclared token account daily, but **no Bank co-signing tool exists in this
//! repository**, so nothing scans before it signs. The pre-signature refusal is a
//! human procedure until one is built. Do not read the co-signature as a control
//! that runs.
//!
//! WHAT THIS CAN AND CANNOT PROVE — stated plainly, because the previous version
//! shipped a burn that LOOKED like a proof:
//!   * CAN prove: PDA lamports are zero; every reserve mint's ATA (both token
//!     programs) is declared, PDA-owned, undelegated and empty; no declared account
//!     is a live Core asset (a nested vault).
//!   * CANNOT prove: completeness. Core exposes no way to enumerate the token
//!     accounts a PDA owns, so a NON-ATA account holding value and simply not
//!     declared is invisible here. ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN
//!     SPEC.md, "THE SHIP GATE" section — ONE place, so this can never drift from
//!     what actually runs. This paragraph used to assert the Bank's co-signature
//!     as the control ("a Solana signature covers the whole transaction, so the
//!     Bank sees every instruction"), which is true of Solana and false of this
//!     repository: NOTHING HERE SIGNS A REDEMPTION. The ⚠️ above corrected the
//!     general claim and this paragraph quietly reasserted it, which is how round
//!     14 found the class surviving in three comments inside its own repair.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
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

/// SEAL's `open_for_redemption`, pinned. The mirror of SEAL's `BURN_PROGRAM_ID` /
/// `IX_BURN_VAULT_DISC` pair, and the same argument applies: the discriminator is
/// asserted against `sha256("global:open_for_redemption")` in the suite, SEAL's
/// `OpenForRedemption` carries the matching "MUST stay account N" comments, and
/// a drift breaks the match, which HALTS redemption rather than permitting one.
pub const IX_OPEN_FOR_REDEMPTION_DISC: [u8; 8] = [244, 178, 130, 11, 158, 107, 45, 95];
const SEAL_IX_ASSET_IDX: usize = 0;
const SEAL_IX_OWNER_IDX: usize = 2;

const IX_BURN_V1: u8 = 12;
const KEY_ASSET_V1: u8 = 1;
const UA_DISC_COLLECTION: u8 = 2;
const TOKEN_ACCOUNT_LEN: usize = 165;
/// MUST EQUAL SEAL's. This program reads the reserve list out of the SEAL config
/// and bounds it, so a larger value here would let BURN accept a list SEAL could
/// never have written, and a smaller one would refuse a legitimate vault. Suite
/// 9.15/9.16 assert both against the MEASURED redemption ceiling — see SEAL.
const MAX_RESERVE_MINTS: usize = 3;
/// This program's own config layout version. See `BurnConfig`.
pub const BURN_CONFIG_VERSION: u8 = 1;
/// How long a Bank or admin rotation sits in public before it takes effect.
const ROTATION_NOTICE_SECS: i64 = 7 * 24 * 3600;

#[program]
pub mod cbob_vault_burn {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, collection: Pubkey, bank: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), INIT_AUTHORITY, BurnError::NotTheInitAuthority);
        let c = &mut ctx.accounts.config;
        c.version = BURN_CONFIG_VERSION;
        c.admin = ctx.accounts.admin.key();
        c.collection = collection;
        c.bank = bank;
        c.bump = ctx.bumps.config;
        c.pending_bank = Pubkey::default(); c.pending_bank_at = 0;
        c.pending_admin = Pubkey::default(); c.pending_admin_at = 0;
        Ok(())
    }

    /// `collection` is deliberately NOT rotatable — it is stamped into every vault at
    /// mint, and changing it would strand every existing vault.
    pub fn update_config(ctx: Context<UpdateConfig>, bank: Option<Pubkey>, admin: Option<Pubkey>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.config;
        // THE SAME NOTICE PERIOD AS SEAL AND MINT. The Bank co-signs the one
        // irreversible instruction in the system, and both it and the admin who
        // can replace it used to rotate on a single signature with no warning.
        if let Some(x) = bank {
            require_keys_neq!(x, Pubkey::default(), BurnError::NothingPending);
            c.pending_bank = x;
            c.pending_bank_at = now.checked_add(ROTATION_NOTICE_SECS).ok_or(BurnError::Overflow)?;
        }
        if let Some(x) = admin {
            require_keys_neq!(x, Pubkey::default(), BurnError::NothingPending);
            c.pending_admin = x;
            c.pending_admin_at = now.checked_add(ROTATION_NOTICE_SECS).ok_or(BurnError::Overflow)?;
        }
        Ok(())
    }

    /// Land a rotation the notice period has released.
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
        require!(did, BurnError::NothingPending);
        Ok(())
    }

    /// Disarm both. The CURRENT admin.
    pub fn cancel_pending(ctx: Context<UpdateConfig>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require!(c.pending_bank != Pubkey::default() || c.pending_admin != Pubkey::default(),
            BurnError::NothingPending);
        c.pending_bank = Pubkey::default(); c.pending_bank_at = 0;
        c.pending_admin = Pubkey::default(); c.pending_admin_at = 0;
        Ok(())
    }

    /// Destroy a vault, and with it release everything it held. Owner AND Bank must
    /// sign — the Bank because this is the one instruction that can permanently
    /// remove value, so it must SCAN THE PDA BEFORE IT SIGNS and alarm on every call.
    ///
    /// This is the only way a vault is ever broken open. It is paired with SEAL's
    /// `open_for_redemption` in BOTH directions: SEAL will not thaw without a burn
    /// for the same asset and owner later in the transaction, and this refuses
    /// without a thaw for the same asset and owner earlier in it.
    ///
    /// WHY REQUIRE THE OPEN, when a burn of a truly empty vault would be harmless?
    /// Because a single shape is a thing the Bank can recognise. Every burn is a
    /// redemption and every redemption is a burn, so an alarm that sees a burn with
    /// no paired thaw is looking at a bare Core `BurnV1` — which is the one attack
    /// this program cannot prevent (the owner can always call Core directly) and
    /// exactly what `detectBurns` is for. A second legitimate burn shape would blunt
    /// that signal. The never-funded mis-mint is served by the same shape with no
    /// sweep instructions in between, which costs nothing.
    ///
    /// It also adds no new way to strand value: contents cannot leave without SEAL
    /// thawing the asset, so a broken SEAL already halts redemption either way.
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

        // ---- the invariant, the other half: a matching THAW came first ----
        //
        // Top-level instructions only. An `open_for_redemption` buried inside another
        // program's CPI cannot satisfy this, and a `burn_vault` reached BY a CPI sees
        // the OUTER instruction's index — so a wrapper would need a genuine top-level
        // open for this exact asset and owner before it, which SEAL in turn only
        // permits when a genuine top-level burn for the same pair follows. Both halves
        // bind asset AND owner, so neither can be borrowed from another vault's
        // redemption sharing the transaction.
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
                    // THE SAME THREE CHECKS AS THE RESERVE LOOP. Harmless today —
                    // once the asset is burned its signer PDA is unreachable and
                    // a delegate on an empty account can do nothing — but the
                    // reserve loop refuses these and this one did not, and a
                    // difference between two loops that should agree is where the
                    // next reader (or the next Core release) finds the gap. Six
                    // comparisons remove the class.
                    require!(d[72..76] == [0,0,0,0], BurnError::ReserveDelegated);
                    require!(d[121..129] == [0u8; 8], BurnError::ReserveDelegated);
                    require!(d[129..133] == [0,0,0,0], BurnError::ReserveDelegated);
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
pub struct BurnConfig {
    /// Layout version, FIRST field at a fixed offset — the same discipline SEAL,
    /// MINT and GOV apply. Round 6 started watching this account for drift on
    /// `bank`, the co-signer on the one irreversible path in the system, and an
    /// unpinned raw-offset read of an upgradeable program's account is a silent
    /// misread waiting for that program's next upgrade. BURN was the last one
    /// without a version byte.
    pub version: u8,
    pub admin: Pubkey, pub collection: Pubkey, pub bank: Pubkey, pub bump: u8,
    /// Rotations waiting out `ROTATION_NOTICE_SECS`.
    pub pending_bank: Pubkey, pub pending_bank_at: i64,
    pub pending_admin: Pubkey, pub pending_admin_at: i64 }

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + 1 + 32*3 + 1 + 32 + 8 + 32 + 8 + CONFIG_PADDING, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, BurnConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApplyPending<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, BurnConfig>,
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
    /// MUST stay account 0 — SEAL's `open_for_redemption` matches on it to prove
    /// this transaction's thaw and this burn are for the same vault.
    #[account(mut)]
    pub vault_asset: UncheckedAccount<'info>,
    /// CHECK: must equal the asset's collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// MUST stay account 2 — SEAL's `open_for_redemption` matches on it.
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
    /// CHECK: instructions sysvar — the burn verifies a preceding thaw.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event] pub struct VaultBurned { pub asset: Pubkey, pub owner: Pubkey, pub declared_accounts: u8 }

#[error_code]
pub enum BurnError {
    #[msg("numeric overflow")] Overflow,
    #[msg("no rotation is armed, or its notice period has not elapsed")] NothingPending,
    #[msg("only the designated init authority may initialize")] NotTheInitAuthority,
    #[msg("the Bank must co-sign every burn")] NotTheBank,
    #[msg("account is not a Metaplex Core AssetV1")] NotACoreAsset,
    #[msg("signer is not the current owner")] NotTheOwner,
    #[msg("this asset does not belong to the CBOB vault collection")] ForeignVault,
    #[msg("the collection account does not match the asset's collection")] WrongCollectionAccount,
    #[msg("the vault is not empty — refusing to burn")] VaultNotEmpty,
    #[msg("burn_vault requires a preceding open_for_redemption for this vault and owner in the same transaction")] NoPrecedingOpen,
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
