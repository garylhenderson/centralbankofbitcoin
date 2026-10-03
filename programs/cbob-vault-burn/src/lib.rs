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
//! v6 (Gary, 2026-10-03): THE PROGRAM IS THE SECOND SIGNER. v5 required the
//! Bank's co-signature here; v6 removes it, so a burn is the owner's signature
//! plus this program's rules. There is no admin either: this config is written
//! once by `initialize` and never again.
//!
//! WHAT THIS CAN AND CANNOT PROVE — stated plainly, because the first version
//! shipped a burn that LOOKED like a proof:
//!   * CAN prove: PDA lamports are zero; every reserve mint's ATA (both token
//!     programs) is declared, PDA-owned, undelegated and empty; no declared account
//!     is a live Core asset (a nested vault).
//!   * CANNOT prove: completeness. Core exposes no way to enumerate the token
//!     accounts a PDA owns, so a NON-ATA account holding value and simply not
//!     declared is invisible here. What covers that gap is the control table in
//!     SPEC.md, "THE SHIP GATE" — ONE place, so this can never drift from what
//!     actually runs. Read the table, not this paragraph.
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
/// Gary's wallet (v6, 2026-10-03). It signs the one-time `initialize` and has no
/// other power in this program.
///
/// ⚠️ THE ONE THING THAT DIFFERS BETWEEN THE TESTED AND SHIPPED BINARY.
/// `--features localnet` swaps in a deterministic test key so the suite can
/// sign. That is a real (small, acknowledged) gap: the binary the suite
/// exercises is not byte-identical to the one that deploys. It is closed the
/// only way it can be — `scripts/build-mainnet.sh` deploys BOTH builds and asks
/// each whether it trusts the test key (mainnet must refuse, localnet accept),
/// then prints the sha256 that must be deployed.
#[cfg(not(feature = "localnet"))]
pub const INIT_AUTHORITY: Pubkey = pubkey!("Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb");
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
/// 2 since v6: SEAL dropped `admin` and `bank`, so collection moved from 41 to 9
/// and the reserve Vec from 105 to 41. A v1 account is refused, never misread.
pub const SEAL_CONFIG_VERSION: u8 = 2;
const OFF_VERSION: usize = 8;
const OFF_COLLECTION: usize = 9;
const OFF_RESERVES: usize = 41;
pub const EXECUTE_PREFIX: &[u8] = b"mpl-core-execute";

/// SEAL's `open_for_redemption`, pinned. The mirror of SEAL's `BURN_PROGRAM_ID` /
/// `IX_BURN_VAULT_DISC` pair, and the same argument applies: the discriminator is
/// asserted against `sha256("global:open_for_redemption")` in the suite, SEAL's
/// `OpenForRedemption` carries the matching "MUST stay account N" comments, and
/// a drift breaks the match, which HALTS redemption rather than permitting one.
pub const IX_OPEN_FOR_REDEMPTION_DISC: [u8; 8] = [244, 178, 130, 11, 158, 107, 45, 95];
const SEAL_IX_ASSET_IDX: usize = 0;
const SEAL_IX_OWNER_IDX: usize = 2;

/// MINT, and its `retire_redeemed` (v6 stage 3). Every redemption takes the vault
/// off the payout schedule in the same instruction that destroys it, so a
/// burned vault can never keep a share of the pool. MINT refuses the call unless
/// it comes from inside THIS instruction for THIS asset, and refuses while a whole
/// sat is still owed (the redeemer claims first). The discriminator is asserted
/// against sha256("global:retire_redeemed") in the suite.
pub const MINT_PROGRAM_ID: Pubkey = pubkey!("Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo");
pub const IX_RETIRE_REDEEMED_DISC: [u8; 8] = [148, 201, 111, 61, 5, 156, 238, 179];

const IX_BURN_V1: u8 = 12;
const KEY_ASSET_V1: u8 = 1;
const UA_DISC_COLLECTION: u8 = 2;
const TOKEN_ACCOUNT_LEN: usize = 165;
/// MUST EQUAL SEAL's. This program reads the reserve list out of the SEAL config
/// and bounds it, so a larger value here would let BURN accept a list SEAL could
/// never have written, and a smaller one would refuse a legitimate vault. Suite
/// 9.15/9.16 assert both against the MEASURED redemption ceiling — see SEAL.
const MAX_RESERVE_MINTS: usize = 3;
/// This program's own config layout version. See `BurnConfig`. 2 since v6.
pub const BURN_CONFIG_VERSION: u8 = 2;

#[program]
pub mod cbob_vault_burn {
    use super::*;

    /// One-time, and the only write this config ever receives. v6 removed the
    /// Bank, the admin and their rotations; `collection` was never rotatable.
    pub fn initialize(ctx: Context<Initialize>, collection: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.authority.key(), INIT_AUTHORITY, BurnError::NotTheInitAuthority);
        let c = &mut ctx.accounts.config;
        c.version = BURN_CONFIG_VERSION;
        c.collection = collection;
        c.bump = ctx.bumps.config;
        c.burned_total = 0;
        Ok(())
    }

    /// Destroy a vault, and with it release everything it held. The OWNER signs;
    /// this program's rules are the other party (v6 — there is no Bank key).
    ///
    /// This is the only way a vault is ever broken open. It is paired with SEAL's
    /// `open_for_redemption` in BOTH directions: SEAL will not thaw without a burn
    /// for the same asset and owner later in the transaction, and this refuses
    /// without a thaw for the same asset and owner earlier in it.
    ///
    /// WHY REQUIRE THE OPEN, when a burn of a truly empty vault would be harmless?
    /// Because a single shape is a thing the alarm can recognise. Every burn is a
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
        // (v6: SEAL no longer carries a Bank, so the Bank cross-check is gone and
        // only `collection` is compared.)
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
        // OFF THE PAYOUT SCHEDULE, IN THE SAME INSTRUCTION. MINT checks that the
        // vault owes nothing (a whole sat still owed refuses the whole redemption:
        // claim first) and removes its weight. MINT validates its own accounts by
        // seeds; this only pins which program it is calling.
        invoke(&Instruction {
            program_id: MINT_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.mint_config.key(), false),
                AccountMeta::new(ctx.accounts.vault_record.key(), false),
                AccountMeta::new_readonly(ctx.accounts.vault_asset.key(), false),
                AccountMeta::new_readonly(ctx.accounts.instructions.key(), false),
            ],
            data: IX_RETIRE_REDEEMED_DISC.to_vec(),
        }, &[
            ctx.accounts.mint_config.to_account_info(),
            ctx.accounts.vault_record.to_account_info(),
            ctx.accounts.vault_asset.to_account_info(),
            ctx.accounts.instructions.to_account_info(),
            ctx.accounts.mint_program.to_account_info(),
        ])?;
        // THE ELECTORATE SHRINKS HERE, AND GOV HAS TO KNOW. v6 stage 1 left the
        // quorum divisor at supply EVER minted while every burn removed a voter,
        // so enough redemptions would have made governance unreachable for good —
        // and with no admin, nothing could have lowered the bar. GOV reads
        // `minted_total - burned_total - bare_burns_retired` when a proposal opens:
        // a BARE Core BurnV1 (proven impossibility 1) does not pass through here,
        // and MINT's `retire_burned` counts it instead (v6 stage 3).
        let c = &mut ctx.accounts.config;
        c.burned_total = c.burned_total.checked_add(1).ok_or(BurnError::Overflow)?;
        emit!(VaultBurned { asset: ctx.accounts.vault_asset.key(), owner: asset_owner, declared_accounts: declared,
            burned_total: c.burned_total });
        Ok(())
    }
}

#[account]
/// NOTE: no `reserve_mints` here on purpose. The reserve set is read from the
/// SEAL config at burn time so the two can never disagree.
pub struct BurnConfig {
    /// Layout version, FIRST field at a fixed offset — the same discipline SEAL,
    /// MINT and GOV apply.
    pub version: u8,
    pub collection: Pubkey,
    pub bump: u8,
    /// Vaults burned through THIS program (every redemption). GOV reads it at
    /// offset 42 to compute live supply. Bare Core burns are not here (stage 3).
    pub burned_total: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 1 + 32 + 1 + 8 + CONFIG_PADDING, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, BurnConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
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
    /// CHECK: Core's asset-signer PDA — the vault itself.
    #[account(mut, seeds = [EXECUTE_PREFIX, vault_asset.key().as_ref()], bump, seeds::program = MPL_CORE_ID)]
    pub asset_signer: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// MUTABLE since v6 stage 2: every burn is counted, for GOV's live supply.
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
}

#[event] pub struct VaultBurned { pub asset: Pubkey, pub owner: Pubkey, pub declared_accounts: u8, pub burned_total: u64 }

#[error_code]
pub enum BurnError {
    #[msg("only the designated init authority may initialize")] NotTheInitAuthority,
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
    #[msg("the seal config is a layout version this program was not compiled against")] SealConfigVersion,
    #[msg("seal_config account is not the seal program's config")] BadSealConfig,
    #[msg("burn wiring has diverged from the seal program's config")] WiringDiverged,
    #[msg("numeric overflow")] Overflow,
}
