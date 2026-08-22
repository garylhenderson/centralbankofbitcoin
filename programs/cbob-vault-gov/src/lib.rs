//! CBOB Vault GOVERNANCE — one vault, one vote.
//!
//! "vote per vault 100%" (Gary, 2026-08-13, asked three times and settled).
//!
//! HOW A VAULT VOTES AS ITSELF, WITH NO INDEXER AND NO SNAPSHOT
//! ------------------------------------------------------------
//! A snapshot needs someone to compute it and everyone else to trust them. This
//! program has neither. A vault votes by SHOWING UP: the voter passes the Core
//! asset account, the program reads the owner out of its bytes (`data[1..33]`),
//! and requires that owner to have signed. Standing is proved at the instant of
//! the vote against live chain state — the same read `open_for_redemption` uses.
//!
//! THE VOTE IS BOUND TO THE ASSET, NOT TO THE WALLET
//! -------------------------------------------------
//! `VoteRecord` is a PDA at ["vote", proposal, ASSET]. Voting a second time with
//! the same vault fails because the account already exists — and that holds
//! however many times the vault changes hands. Sell a voted vault and the buyer
//! inherits a vault that has already spoken on every open proposal. Without this
//! binding, one vault could vote, transfer, vote, transfer, and carry a whole
//! round on its own.
//!
//! WHAT A RATIFIED VOTE CAN DO
//! ---------------------------
//! Exactly one thing: CPI `set_round` on the MINT program. This program holds the
//! ["gov"] PDA that MINT's config names as its governance authority, so it is the
//! only route to a round — and MINT bounds what a round may say (a real cap, a
//! bounded window) and enforces the lifetime supply ceiling independently. A
//! hostile majority here still cannot mint past `max_supply`.
//!
//! QUORUM IS MEASURED AGAINST LIVE SUPPLY, read from MINT's own `minted_total`.
//! That counter used to be written and never read; it is now load-bearing twice.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

declare_id!("2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2");

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
pub const MINT_PROGRAM_ID: Pubkey = pubkey!("Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo");
/// ⚠️ SET TO THE SQUADS MULTISIG BEFORE THE MAINNET BUILD.
pub const INIT_AUTHORITY: Pubkey = pubkey!("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");
pub const CONFIG_SEED: &[u8] = b"gov-config";
pub const GOV_SEED: &[u8] = b"gov";
pub const PROPOSAL_SEED: &[u8] = b"proposal";
pub const VOTE_SEED: &[u8] = b"vote";

const KEY_ASSET_V1: u8 = 1;
const UA_DISC_COLLECTION: u8 = 2;
/// MINT's `MintConfig`, PINNED by discriminator AND version byte — the same
/// discipline MINT/BURN apply to SEAL's config, for the same reason: an unpinned
/// raw-offset read of a sibling program's account is a silent misread waiting for
/// that program's next upgrade.
/// disc[0..8] version[8] admin[9..41] collection[41..73] bank[73..105]
/// governance[105..137] treasury[137..169] round_id[169..173] opens_at[173..181]
/// closes_at[181..189] price[189..197] cap[197..201] minted_this_round[201..205]
/// minted_total[205..213] max_supply[213..221] bump[221]
pub const MINT_CONFIG_DISC: [u8; 8] = [168, 252, 88, 182, 219, 205, 39, 53];
pub const MINT_CONFIG_VERSION: u8 = 1;
const OFF_MINT_VERSION: usize = 8;
const OFF_MINT_GOVERNANCE: usize = 105;
const OFF_MINT_MINTED_TOTAL: usize = 205;
/// Anchor discriminator of MINT's `set_round` = sha256("global:set_round")[..8].
/// COMPUTED, not guessed — the first draft of this constant was wrong.
const IX_SET_ROUND: [u8; 8] = [44, 204, 0, 190, 137, 127, 106, 78];

/// Bounds a proposal must satisfy before it is even worth voting on. These mirror
/// MINT's own checks so a proposal that could never execute cannot be created and
/// waste a voting period.
/// The voting period is a CONFIG value, not a constant, with a hard floor.
///
/// It has to be configurable to be testable: a constant one-day minimum cannot be
/// exercised on a validator without waiting a day, and an execute path that has
/// never run is not a path anyone should trust with a supply decision. The floor
/// stops it being set to something meaningless.
///
/// ⚠️ THE DEPLOYED VALUE MUST BE DAYS, NOT THE FLOOR. Holders need time to see a
/// proposal and vote; a short window is how a coordinated minority wins a vote
/// nobody else noticed. The Bank's alarm pipeline asserts the live config value.
const MIN_VOTING_SECS_FLOOR: i64 = 60;
const MAX_VOTING_SECS: i64 = 60 * 60 * 24 * 30;
const MAX_ROUND_SECS: i64 = 365 * 24 * 3600;

#[program]
pub mod cbob_vault_gov {
    use super::*;

    /// `quorum_bps` — share of LIVE supply that must vote for a result to count.
    /// `threshold_bps` — share of votes cast that must be YES.
    pub fn initialize(
        ctx: Context<Initialize>,
        collection: Pubkey,
        quorum_bps: u16,
        threshold_bps: u16,
        min_voting_secs: i64,
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), INIT_AUTHORITY, GovError::NotTheInitAuthority);
        require!(quorum_bps > 0 && quorum_bps <= 10_000, GovError::BadThreshold);
        // A simple majority of votes cast is the floor; anything less lets a
        // minority of a quorum carry a round.
        require!(threshold_bps > 5_000 && threshold_bps <= 10_000, GovError::BadThreshold);
        require!((MIN_VOTING_SECS_FLOOR..=MAX_VOTING_SECS).contains(&min_voting_secs), GovError::BadWindow);
        let c = &mut ctx.accounts.config;
        c.min_voting_secs = min_voting_secs;
        c.admin = ctx.accounts.admin.key();
        c.collection = collection;
        c.quorum_bps = quorum_bps;
        c.threshold_bps = threshold_bps;
        c.proposal_count = 0;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Anyone holding a vault may propose. Standing is proved the same way a vote
    /// is — by producing the asset and the owner's signature — so there is no
    /// separate proposer allowlist to maintain or capture.
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        opens_at: i64,
        closes_at: i64,
        price_lamports: u64,
        cap: u32,
        voting_ends_at: i64,
    ) -> Result<()> {
        let (owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
        require_keys_eq!(owner, ctx.accounts.proposer.key(), GovError::NotTheOwner);
        require_keys_eq!(collection, ctx.accounts.config.collection, GovError::ForeignVault);

        let now = Clock::get()?.unix_timestamp;
        let dur = voting_ends_at.checked_sub(now).ok_or(GovError::BadWindow)?;
        require!(dur >= ctx.accounts.config.min_voting_secs && dur <= MAX_VOTING_SECS, GovError::BadWindow);
        // Refuse a proposal MINT would reject anyway — otherwise a month of voting
        // ends in an execute that cannot land.
        require!(closes_at > opens_at, GovError::BadWindow);
        require!(closes_at - opens_at <= MAX_ROUND_SECS, GovError::BadWindow);
        require!(cap > 0, GovError::BadWindow);

        let cfg = &mut ctx.accounts.config;
        cfg.proposal_count = cfg.proposal_count.checked_add(1).ok_or(GovError::Overflow)?;

        let p = &mut ctx.accounts.proposal;
        p.id = cfg.proposal_count;
        p.opens_at = opens_at;
        p.closes_at = closes_at;
        p.price_lamports = price_lamports;
        p.cap = cap;
        p.voting_ends_at = voting_ends_at;
        p.yes = 0;
        p.no = 0;
        p.executed = false;
        p.bump = ctx.bumps.proposal;
        emit!(ProposalCreated { id: p.id, proposer: owner, opens_at, closes_at, price_lamports, cap, voting_ends_at });
        Ok(())
    }

    /// One vault, one vote. The VoteRecord PDA is seeded by the ASSET, so a vault
    /// that has voted cannot vote again in any hands.
    pub fn cast_vote(ctx: Context<CastVote>, support: bool) -> Result<()> {
        let (owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
        require_keys_eq!(owner, ctx.accounts.owner.key(), GovError::NotTheOwner);
        require_keys_eq!(collection, ctx.accounts.config.collection, GovError::ForeignVault);

        let now = Clock::get()?.unix_timestamp;
        require!(now < ctx.accounts.proposal.voting_ends_at, GovError::VotingClosed);
        require!(!ctx.accounts.proposal.executed, GovError::AlreadyExecuted);

        let p = &mut ctx.accounts.proposal;
        if support { p.yes = p.yes.checked_add(1).ok_or(GovError::Overflow)?; }
        else { p.no = p.no.checked_add(1).ok_or(GovError::Overflow)?; }

        let v = &mut ctx.accounts.vote_record;
        v.proposal = p.key();
        v.asset = ctx.accounts.vault_asset.key();
        v.support = support;
        v.bump = ctx.bumps.vote_record;
        emit!(VoteCast { proposal: p.key(), asset: v.asset, voter: owner, support, yes: p.yes, no: p.no });
        Ok(())
    }

    /// Ratify. Quorum is measured against MINT's live `minted_total`, so it tracks
    /// real supply instead of a snapshot somebody has to be trusted to have taken.
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now >= ctx.accounts.proposal.voting_ends_at, GovError::VotingOpen);
        require!(!ctx.accounts.proposal.executed, GovError::AlreadyExecuted);

        // read live supply + confirm THIS program is MINT's governance authority
        let (gov_pda, gov_bump) = Pubkey::find_program_address(&[GOV_SEED], &crate::ID);
        let minted_total = {
            let (expected, _) = Pubkey::find_program_address(&[b"mint-config"], &MINT_PROGRAM_ID);
            require_keys_eq!(ctx.accounts.mint_config.key(), expected, GovError::BadMintConfig);
            require_keys_eq!(*ctx.accounts.mint_config.owner, MINT_PROGRAM_ID, GovError::BadMintConfig);
            let d = ctx.accounts.mint_config.try_borrow_data()?;
            require!(d.len() >= OFF_MINT_MINTED_TOTAL + 8, GovError::BadMintConfig);
            require!(d[..8] == MINT_CONFIG_DISC, GovError::BadMintConfig);
            require!(d[OFF_MINT_VERSION] == MINT_CONFIG_VERSION, GovError::BadMintConfig);
            let mut g = [0u8; 32]; g.copy_from_slice(&d[OFF_MINT_GOVERNANCE..OFF_MINT_GOVERNANCE + 32]);
            // If MINT does not name us, the CPI below would fail anyway — say so
            // clearly instead of surfacing a ConstraintHasOne from another program.
            require_keys_eq!(Pubkey::new_from_array(g), gov_pda, GovError::NotTheGovernanceAuthority);
            let mut t = [0u8; 8]; t.copy_from_slice(&d[OFF_MINT_MINTED_TOTAL..OFF_MINT_MINTED_TOTAL + 8]);
            u64::from_le_bytes(t)
        };

        let p = &mut ctx.accounts.proposal;
        let cast = (p.yes as u128) + (p.no as u128);
        require!(cast > 0, GovError::QuorumNotMet);
        // quorum: votes cast vs live supply
        let need = (minted_total as u128)
            .checked_mul(ctx.accounts.config.quorum_bps as u128).ok_or(GovError::Overflow)? / 10_000u128;
        require!(cast >= need, GovError::QuorumNotMet);
        // threshold: YES share of votes cast
        let yes_bps = (p.yes as u128).checked_mul(10_000).ok_or(GovError::Overflow)? / cast;
        require!(yes_bps >= ctx.accounts.config.threshold_bps as u128, GovError::ThresholdNotMet);

        p.executed = true;

        let mut data = Vec::with_capacity(8 + 8 + 8 + 8 + 4);
        data.extend_from_slice(&IX_SET_ROUND);
        data.extend_from_slice(&p.opens_at.to_le_bytes());
        data.extend_from_slice(&p.closes_at.to_le_bytes());
        data.extend_from_slice(&p.price_lamports.to_le_bytes());
        data.extend_from_slice(&p.cap.to_le_bytes());
        invoke_signed(
            &Instruction {
                program_id: MINT_PROGRAM_ID,
                accounts: vec![
                    AccountMeta::new(ctx.accounts.mint_config.key(), false),
                    AccountMeta::new_readonly(gov_pda, true),
                ],
                data,
            },
            &[ctx.accounts.mint_config.to_account_info(), ctx.accounts.governance.to_account_info()],
            &[&[GOV_SEED, &[gov_bump]]],
        )?;
        emit!(ProposalExecuted { id: p.id, yes: p.yes, no: p.no, minted_total });
        Ok(())
    }
}

/// Returns (owner, collection) from a live Core AssetV1. Identical read to the
/// one the seal program uses — standing is chain state, not a stored list.
fn read_core_asset(asset: &UncheckedAccount) -> Result<(Pubkey, Pubkey)> {
    require_keys_eq!(*asset.owner, MPL_CORE_ID, GovError::NotACoreAsset);
    let d = asset.try_borrow_data()?;
    require!(d.len() >= 66 && d[0] == KEY_ASSET_V1, GovError::NotACoreAsset);
    require!(d[33] == UA_DISC_COLLECTION, GovError::ForeignVault);
    let mut o = [0u8; 32]; o.copy_from_slice(&d[1..33]);
    let mut c = [0u8; 32]; c.copy_from_slice(&d[34..66]);
    Ok((Pubkey::new_from_array(o), Pubkey::new_from_array(c)))
}

#[account]
pub struct GovConfig {
    pub admin: Pubkey,
    pub collection: Pubkey,
    pub quorum_bps: u16,
    pub threshold_bps: u16,
    pub min_voting_secs: i64,
    pub proposal_count: u64,
    pub bump: u8,
}

#[account]
pub struct Proposal {
    pub id: u64,
    pub opens_at: i64,
    pub closes_at: i64,
    pub price_lamports: u64,
    pub cap: u32,
    pub voting_ends_at: i64,
    pub yes: u64,
    pub no: u64,
    pub executed: bool,
    pub bump: u8,
}

#[account]
pub struct VoteRecord {
    pub proposal: Pubkey,
    pub asset: Pubkey,
    pub support: bool,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + 32 + 32 + 2 + 2 + 8 + 8 + 1, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, GovConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GovConfig>,
    #[account(init, payer = proposer, space = 8 + 8 + 8 + 8 + 8 + 4 + 8 + 8 + 8 + 1 + 1,
        seeds = [PROPOSAL_SEED, &(config.proposal_count + 1).to_le_bytes()], bump)]
    pub proposal: Account<'info, Proposal>,
    /// CHECK: live Core AssetV1 proving the proposer holds a vault.
    pub vault_asset: UncheckedAccount<'info>,
    #[account(mut)]
    pub proposer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GovConfig>,
    #[account(mut, seeds = [PROPOSAL_SEED, &proposal.id.to_le_bytes()], bump = proposal.bump)]
    pub proposal: Account<'info, Proposal>,
    /// THE BINDING. Seeded by the ASSET, so a vault votes once per proposal no
    /// matter who holds it — transfer-then-vote-again hits an existing account.
    #[account(init, payer = payer, space = 8 + 32 + 32 + 1 + 1,
        seeds = [VOTE_SEED, proposal.key().as_ref(), vault_asset.key().as_ref()], bump)]
    pub vote_record: Account<'info, VoteRecord>,
    /// CHECK: live Core AssetV1; its owner bytes must match `owner`.
    pub vault_asset: UncheckedAccount<'info>,
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GovConfig>,
    #[account(mut, seeds = [PROPOSAL_SEED, &proposal.id.to_le_bytes()], bump = proposal.bump)]
    pub proposal: Account<'info, Proposal>,
    /// CHECK: MINT's config PDA; verified in-handler and written by the CPI.
    #[account(mut)]
    pub mint_config: UncheckedAccount<'info>,
    /// CHECK: this program's ["gov"] PDA — the authority MINT names as governance.
    #[account(seeds = [GOV_SEED], bump)]
    pub governance: UncheckedAccount<'info>,
    /// CHECK: the MINT program.
    #[account(address = MINT_PROGRAM_ID)]
    pub mint_program: UncheckedAccount<'info>,
}

#[event] pub struct ProposalCreated { pub id: u64, pub proposer: Pubkey, pub opens_at: i64, pub closes_at: i64, pub price_lamports: u64, pub cap: u32, pub voting_ends_at: i64 }
#[event] pub struct VoteCast { pub proposal: Pubkey, pub asset: Pubkey, pub voter: Pubkey, pub support: bool, pub yes: u64, pub no: u64 }
#[event] pub struct ProposalExecuted { pub id: u64, pub yes: u64, pub no: u64, pub minted_total: u64 }

#[error_code]
pub enum GovError {
    #[msg("only the designated init authority may initialize")] NotTheInitAuthority,
    #[msg("account is not a Metaplex Core AssetV1")] NotACoreAsset,
    #[msg("signer is not the current owner of this vault")] NotTheOwner,
    #[msg("this asset does not belong to the CBOB vault collection")] ForeignVault,
    #[msg("voting has closed on this proposal")] VotingClosed,
    #[msg("voting is still open")] VotingOpen,
    #[msg("this proposal has already been executed")] AlreadyExecuted,
    #[msg("quorum was not met against live vault supply")] QuorumNotMet,
    #[msg("the YES share did not reach the threshold")] ThresholdNotMet,
    #[msg("bad voting or round window")] BadWindow,
    #[msg("quorum/threshold out of range")] BadThreshold,
    #[msg("the mint config account is not the MINT program's config")] BadMintConfig,
    #[msg("the MINT program does not name this program as its governance authority")] NotTheGovernanceAuthority,
    #[msg("numeric overflow")] Overflow,
}
