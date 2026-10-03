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
//! v6 (Gary, 2026-10-03): THERE IS NO ADMIN. Stage 3b (red-team 1: the FIRST
//! charter vault could carry any vote alone and reach the money wiring) cut what a
//! vote can reach to what may safely change. A proposal carries up to
//! `MAX_ACTIONS` actions, at most one of each kind, executed in order in ONE
//! transaction (all or nothing), each a CPI into MINT signed by the ["gov"] PDA:
//!   * `SetRound`        -> MINT `set_round` (when a sale opens, what it costs)
//!   * `Brakes`          -> MINT `set_guardian` and/or `restart`. The guardian
//!                          (Gary's wallet) can only STOP sales or the sweep; this
//!                          is the only way to start either again, and the only
//!                          way to replace or retire the guardian.
//!   * `TightenSweep`    -> MINT `tighten_sweep` (the one trusted hop, SMALLER only)
//!   * `ArmSwapOperator` -> MINT `arm_swap_operator` (lands after 7 days' notice)
//! NOT REACHABLE BY ANY VOTE: the 85/15 split, where the 85% and the 15% go, and
//! `max_supply`. They are written once by MINT's `initialize`.
//!
//! STAGE 3b ALSO: no proposal before the charter window closes (every charter
//! member votes on the first one), and a proposal needs YES votes from at least
//! 10% of the live supply it snapshotted, on top of quorum and threshold.
//! MINT bounds what each action may say independently. A hostile majority here still cannot mint past `max_supply`,
//! and nothing here can reach a vault: SEAL and BURN have no governance at all.
//!
//! THE GOVERNANCE PARAMETERS ARE FIXED AT `initialize`, so the divisor has to be
//! right on its own: nothing can lower quorum later.
//!
//! v6 STAGE 2: A PROPOSAL'S ELECTORATE IS FIXED WHEN IT OPENS.
//!   * `index_snapshot` = MINT's `minted_total` at creation. A vault may vote only
//!     if its mint index (MINT's `VaultRecord`) is BELOW it. A vault minted while
//!     a vote is open cannot vote on it — v5 relied on the Bank refusing to
//!     co-sign such mints, and v6 has no Bank.
//!   * `quorum_supply` = LIVE supply at creation: `minted_total - burned_total`
//!     (BURN counts every redemption). Stage 1 used supply EVER minted, so every
//!     burn removed a voter and kept its weight in the bar; enough redemptions and
//!     governance would have frozen with no admin to lower it.
//!   * The divisor at execute is the SNAPSHOT, not `max(snapshot, live)`. Round 8
//!     moved to `max` because a vault minted mid-vote added a whole vote and no bar;
//!     with the electorate frozen it adds neither, and `max` would instead let
//!     anyone in an open round BLOCK a proposal by minting vaults that cannot vote.
//!   * v6 STAGE 3: live supply also subtracts MINT's `bare_burns_retired` — a
//!     vault its owner destroyed with a bare Core BurnV1, once anyone has called
//!     MINT's `retire_burned` for it. Until that call it still counts, which can
//!     only make a proposal HARDER to pass, never easier.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

declare_id!("2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2");

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
pub const MINT_PROGRAM_ID: Pubkey = pubkey!("Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo");
/// Gary's wallet (v6, 2026-10-03). It signs the one-time `initialize` and has no
/// other power in this program.
///
/// ⚠️ THE ONE THING THAT DIFFERS BETWEEN THE TESTED AND SHIPPED BINARY.
/// `--features localnet` swaps in a deterministic test key so the suite can
/// sign. `scripts/build-mainnet.sh` deploys BOTH builds and asks each whether it
/// trusts the test key (mainnet must refuse, localnet accept).
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
/// v6 stage 3b (version 4) layout, stage-3 fields unmoved, four appended at the end:
/// disc[0..8] version[8] collection[9..41] governance[41..73] pool_ata[73..105]
/// round_id[105..109] opens_at[109..117] closes_at[117..125] price[125..133]
/// cap[133..137] minted_this_round[137..141] minted_total[141..149]
/// max_supply[149..157] bank_treasury[157..189] split_bps[189..191]
/// sales_stopped[191] sweep_stopped[192] guardian[193..225]
/// swap_operator[225..257] sol_reserve_lamports[257..265] bump[265]
/// max_sweep_lamports[266..274] sweep_cooldown_secs[274..282] ...
/// charter_closes_at[442..450] charter_claimed[450..454] bare_burns_retired[454..462] ...
pub const MINT_CONFIG_DISC: [u8; 8] = [168, 252, 88, 182, 219, 205, 39, 53];
pub const MINT_CONFIG_VERSION: u8 = 4;
const OFF_MINT_VERSION: usize = 8;
const OFF_MINT_GOVERNANCE: usize = 41;
const OFF_MINT_MINTED_TOTAL: usize = 141;
/// Vaults destroyed by a BARE Core burn and retired by MINT (v6 stage 3).
const OFF_MINT_BARE_RETIRED: usize = 454;
/// Stage 3b: no proposal before this (rule C).
const OFF_MINT_CHARTER_CLOSES: usize = 442;
/// Stage 3b: the live sweep bounds, so a loosening is refused at creation (rule B).
const OFF_MINT_SOL_RESERVE: usize = 257;
const OFF_MINT_MAX_SWEEP: usize = 266;
const OFF_MINT_COOLDOWN: usize = 274;
/// BURN's `BurnConfig`, pinned the same way: disc[0..8] version[8]
/// collection[9..41] bump[41] burned_total[42..50] (version 3 since stage 3b
/// appended the redemption rate limit after it).
pub const BURN_PROGRAM_ID: Pubkey = pubkey!("8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8");
pub const BURN_CONFIG_DISC: [u8; 8] = [90, 69, 15, 87, 119, 190, 109, 45];
pub const BURN_CONFIG_VERSION: u8 = 3;
const OFF_BURN_VERSION: usize = 8;
const OFF_BURN_TOTAL: usize = 42;
/// MINT's per-vault `VaultRecord` at ["vault", asset]: disc[0..8] version[8]
/// asset[9..41] mint_index[41..49].
pub const VAULT_RECORD_DISC: [u8; 8] = [47, 1, 218, 116, 82, 70, 124, 119];
pub const VAULT_RECORD_VERSION: u8 = 2;
const OFF_REC_VERSION: usize = 8;
const OFF_REC_ASSET: usize = 9;
const OFF_REC_INDEX: usize = 41;
/// Mirrors MINT's floor so a proposal MINT would refuse cannot waste a vote.
const MIN_ROUND_PRICE_SATS: u64 = 21_000;
/// Anchor discriminators of the MINT instructions a proposal may call, each
/// sha256("global:<name>")[..8]. COMPUTED, not guessed — the first draft of
/// `IX_SET_ROUND` was wrong — and every one is asserted against its derivation
/// in the suite.
const IX_SET_ROUND: [u8; 8] = [44, 204, 0, 190, 137, 127, 106, 78];
const IX_RESTART: [u8; 8] = [29, 35, 207, 34, 51, 201, 132, 40];
const IX_SET_GUARDIAN: [u8; 8] = [147, 243, 50, 121, 154, 164, 50, 30];
const IX_TIGHTEN_SWEEP: [u8; 8] = [232, 151, 101, 201, 11, 244, 105, 118];
const IX_ARM_SWAP_OPERATOR: [u8; 8] = [86, 59, 14, 198, 157, 17, 51, 245];
/// Up to this many actions per proposal, at most ONE OF EACH KIND, so four is
/// every kind at once (rule E). Measured in the suite: a four-action execute
/// is five CPIs and fits a legacy transaction with room to spare.
pub const MAX_ACTIONS: usize = 4;
/// The largest Borsh encoding of one `ProposalAction`: `Brakes` = tag 1 + 3
/// bools + Option<Pubkey> 33 = 37. `SetRound` 1+28, `TightenSweep` 1+27,
/// `ArmSwapOperator` 1+32.
const ACTION_MAX_BYTES: usize = 37;
const ACTIONS_SPACE: usize = 4 + MAX_ACTIONS * ACTION_MAX_BYTES;
/// Rule D: YES votes must reach this share of the snapshotted live supply.
pub const MIN_TURNOUT_YES_BPS: u128 = 1_000;

/// Bounds a proposal must satisfy before it is even worth voting on. These mirror
/// MINT's own checks so a proposal that could never execute cannot be created and
/// waste a voting period.
/// The voting period is a CONFIG value, not a constant, with a hard floor.
///
/// It has to be configurable to be testable: a constant one-day minimum cannot be
/// exercised on a validator without waiting a day, and an execute path that has
/// never run is not a path anyone should trust with a supply decision. The floor
/// stops it being set to something meaningless. v6: fixed at `initialize`.
///
/// ⚠️ THE DEPLOYED VALUE MUST BE DAYS, NOT THE FLOOR. Holders need time to see a
/// proposal and vote; a short window is how a coordinated minority wins a vote
/// nobody else noticed. The Bank's alarm pipeline asserts the live config value.
const MIN_VOTING_SECS_FLOOR: i64 = 60;
/// Below this a quorum is arithmetic rather than policy: with ceiling division
/// `quorum_bps = 1` needs exactly one vote, so an admin key plus one vault
/// carries anything. It must be able to come DOWN — the divisor never falls
/// while burns remove voters — but not to nothing.
const MIN_QUORUM_BPS: u16 = 500;
/// Above this a threshold is a deadlock rather than a safeguard. At 10,000 one
/// NO vote makes any proposal unreachable, and `set_round` has no caller but a
/// ratified proposal — so governance would be dead and the sale over,
/// permanently, on one admin signature that cannot be undone.
const MAX_THRESHOLD_BPS: u16 = 7_500;
const MAX_VOTING_SECS: i64 = 60 * 60 * 24 * 30;
const MAX_ROUND_SECS: i64 = 365 * 24 * 3600;
/// HOW LONG A PASSED PROPOSAL STAYS EXECUTABLE.
///
/// Round 6: without this, a ratified proposal never expired and anybody could
/// execute it at a moment of their choosing, years later. `set_round` overwrites
/// the live round wholesale and resets `minted_this_round`, so an old proposal
/// with a cheap price and a long window was a grenade with the pin out — held by
/// nobody in particular, detonated whenever it was most inconvenient. There was
/// no cancel either. A vote is a decision about NOW; if nobody lands it inside a
/// week, the right answer is to vote again, not to leave it lying around.
const EXECUTION_WINDOW_SECS: i64 = 7 * 24 * 3600;
/// Layout version, first field of GovConfig. The Bank alarm reads this account
/// by raw offset and it is the ONLY thing asserting `min_voting_secs` is days
/// rather than the testing floor, so an unpinned read there is a silent misread
/// of exactly the value nothing else checks. 2 since v6 (`admin` and its
/// rotation are gone, so `quorum_bps` moved from 73 to 41). 3 since stage 3b
/// (`last_executed_id` became three per-kind marks, see `execute_proposal`).
pub const GOV_CONFIG_VERSION: u8 = 3;

#[program]
pub mod cbob_vault_gov {
    use super::*;

    /// `quorum_bps` — share of supply that must vote for a result to count.
    /// `threshold_bps` — share of votes cast that must be YES.
    /// One-time, and v6 has no way to change any of these afterwards.
    pub fn initialize(
        ctx: Context<Initialize>,
        collection: Pubkey,
        quorum_bps: u16,
        threshold_bps: u16,
        min_voting_secs: i64,
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.authority.key(), INIT_AUTHORITY, GovError::NotTheInitAuthority);
        require!(quorum_bps >= MIN_QUORUM_BPS && quorum_bps <= 10_000, GovError::BadThreshold);
        // A simple majority of votes cast is the floor; anything less lets a
        // minority of a quorum carry a round.
        require!(threshold_bps > 5_000 && threshold_bps <= MAX_THRESHOLD_BPS, GovError::BadThreshold);
        require!((MIN_VOTING_SECS_FLOOR..=MAX_VOTING_SECS).contains(&min_voting_secs), GovError::BadWindow);
        let c = &mut ctx.accounts.config;
        c.version = GOV_CONFIG_VERSION;
        c.min_voting_secs = min_voting_secs;
        c.collection = collection;
        c.quorum_bps = quorum_bps;
        c.threshold_bps = threshold_bps;
        c.proposal_count = 0;
        c.last_round_id = 0;
        c.last_guardian_id = 0;
        c.last_arm_id = 0;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Anyone holding a vault may propose, once the charter window has closed.
    /// Standing is proved the same way a vote is — by producing the asset and the
    /// owner's signature — so there is no separate proposer allowlist.
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        actions: Vec<ProposalAction>,
        voting_ends_at: i64,
    ) -> Result<()> {
        // THE QUORUM DIVISOR IS FIXED HERE, not at execute. See the header.
        let m = read_mint_config(&ctx.accounts.mint_config)?;
        let burned_total = read_burn_total(&ctx.accounts.burn_config)?;
        let quorum_supply = m.minted_total.checked_sub(burned_total).ok_or(GovError::BadBurnConfig)?
            .checked_sub(m.bare_retired).ok_or(GovError::BadMintConfig)?;
        let (owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
        require_keys_eq!(owner, ctx.accounts.proposer.key(), GovError::NotTheOwner);
        require_keys_eq!(collection, ctx.accounts.config.collection, GovError::ForeignVault);

        let now = Clock::get()?.unix_timestamp;
        // RULE C (red-team 1, finding 1). During the charter window the electorate
        // is whoever has claimed so far, and the electorate is frozen when a
        // proposal opens. Measured: the FIRST claimant could open a proposal with
        // a quorum of one, vote it through alone, and every later vault was
        // VaultTooNew. Nothing is proposed until every charter member has had the
        // whole window to claim.
        require!(now >= m.charter_closes_at, GovError::CharterNotClosed);

        let dur = voting_ends_at.checked_sub(now).ok_or(GovError::BadWindow)?;
        require!(dur >= ctx.accounts.config.min_voting_secs && dur <= MAX_VOTING_SECS, GovError::BadWindow);

        // RULE E: a bounded list, at most one action of each kind, never empty.
        require!(!actions.is_empty(), GovError::EmptyAction);
        require!(actions.len() <= MAX_ACTIONS, GovError::TooManyActions);
        let mut seen = [false; 4];
        for a in actions.iter() {
            let k = a.kind();
            require!(!seen[k], GovError::DuplicateAction);
            seen[k] = true;
            // Refuse a proposal MINT would reject anyway — otherwise a month of
            // voting ends in an execute that cannot land. MINT re-checks every
            // value when the CPI arrives.
            match a {
                ProposalAction::SetRound { opens_at, closes_at, cap, price } => {
                    require!(*price >= MIN_ROUND_PRICE_SATS, GovError::PriceBelowFloor);
                    require!(closes_at > opens_at, GovError::BadWindow);
                    require!(closes_at.checked_sub(*opens_at).ok_or(GovError::BadWindow)? <= MAX_ROUND_SECS,
                        GovError::BadWindow);
                    require!(*cap > 0, GovError::BadWindow);
                }
                ProposalAction::Brakes { restart_sales, restart_sweep, set_guardian, .. } => {
                    require!(*restart_sales || *restart_sweep || *set_guardian, GovError::EmptyAction);
                }
                ProposalAction::TightenSweep(t) => {
                    require!(t.sol_reserve_lamports.is_some() || t.max_sweep_lamports.is_some()
                        || t.sweep_cooldown_secs.is_some(), GovError::EmptyAction);
                    // RULE B: one direction only, judged against what is live NOW.
                    // (MINT applies it as "at least this tight" at execute, so a
                    // proposal overtaken by a tighter one is a no-op there, never
                    // a loosening and never a failure that drags its siblings down.)
                    if let Some(x) = t.sol_reserve_lamports { require!(x > m.sol_reserve, GovError::Loosening); }
                    if let Some(x) = t.max_sweep_lamports { require!(x < m.max_sweep, GovError::Loosening); }
                    if let Some(x) = t.sweep_cooldown_secs { require!(x > m.cooldown, GovError::Loosening); }
                }
                ProposalAction::ArmSwapOperator { operator } => {
                    require_keys_neq!(*operator, Pubkey::default(), GovError::EmptyAction);
                }
            }
        }

        let cfg = &mut ctx.accounts.config;
        cfg.proposal_count = cfg.proposal_count.checked_add(1).ok_or(GovError::Overflow)?;

        let p = &mut ctx.accounts.proposal;
        p.id = cfg.proposal_count;
        p.actions = actions.clone();
        p.voting_ends_at = voting_ends_at;
        p.yes = 0;
        p.no = 0;
        p.executed = false;
        p.bump = ctx.bumps.proposal;
        p.quorum_supply = quorum_supply;
        p.index_snapshot = m.minted_total;
        p.created_at = now;
        // THE RULE IS SNAPSHOTTED WITH THE DIVISOR (round 6). A tally rule applied
        // retroactively to votes already cast under a different rule is not a rule.
        // v6 fixes both at `initialize` too; the snapshot keeps this true if that
        // ever changes.
        p.quorum_bps = ctx.accounts.config.quorum_bps;
        p.threshold_bps = ctx.accounts.config.threshold_bps;
        emit!(ProposalCreated { id: p.id, proposer: owner, actions, voting_ends_at, quorum_supply });
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

        // THE ELECTORATE IS THE ONE THAT EXISTED WHEN THE PROPOSAL OPENED.
        let index = read_vault_index(&ctx.accounts.vault_record, &ctx.accounts.vault_asset.key())?;
        require!(index < ctx.accounts.proposal.index_snapshot, GovError::VaultTooNew);

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

    /// Ratify. Quorum is measured against the supply SNAPSHOTTED INTO THE PROPOSAL
    /// when it was created — see the header.
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now >= ctx.accounts.proposal.voting_ends_at, GovError::VotingOpen);
        // ONE EXECUTION PER PROPOSAL, whatever else has executed.
        require!(!ctx.accounts.proposal.executed, GovError::AlreadyExecuted);
        // A passed proposal is not a bearer instrument. See EXECUTION_WINDOW_SECS.
        require!(now <= ctx.accounts.proposal.voting_ends_at
            .checked_add(EXECUTION_WINDOW_SECS).ok_or(GovError::Overflow)?, GovError::ProposalExpired);

        // confirm THIS program is still MINT's governance authority
        let (gov_pda, gov_bump) = Pubkey::find_program_address(&[GOV_SEED], &crate::ID);
        let m = read_mint_config(&ctx.accounts.mint_config)?;
        require_keys_eq!(m.governance, gov_pda, GovError::NotTheGovernanceAuthority);

        let p = &mut ctx.accounts.proposal;
        let cast = (p.yes as u128) + (p.no as u128);
        require!(cast > 0, GovError::QuorumNotMet);
        // quorum: votes cast vs the live supply SNAPSHOTTED WHEN THE PROPOSAL
        // OPENED. CEILING, and never zero (a quorum that rounds to nothing is not
        // a quorum).
        let divisor = p.quorum_supply as u128;
        let need = divisor.checked_mul(p.quorum_bps as u128).ok_or(GovError::Overflow)?
            .checked_add(9_999).ok_or(GovError::Overflow)? / 10_000u128;
        require!(need > 0, GovError::QuorumNotMet);
        require!(cast >= need, GovError::QuorumNotMet);
        // threshold: YES share of votes cast
        let yes_bps = (p.yes as u128).checked_mul(10_000).ok_or(GovError::Overflow)? / cast;
        require!(yes_bps >= p.threshold_bps as u128, GovError::ThresholdNotMet);
        // RULE D, minimum turnout: YES alone must reach 10% (ceiling) of the
        // snapshotted live supply. Quorum counts NO votes too, and the threshold
        // is a share of whoever turned up, so neither stops a small, motivated
        // group carrying a vote nobody else noticed.
        let need_yes = divisor.checked_mul(MIN_TURNOUT_YES_BPS).ok_or(GovError::Overflow)?
            .checked_add(9_999).ok_or(GovError::Overflow)? / 10_000u128;
        require!(need_yes > 0 && (p.yes as u128) >= need_yes, GovError::TurnoutTooLow);

        // ORDERING, per KIND, not across the whole sequence (red-team 1 finding
        // 2). Until stage 3b execution only moved forward by id across every
        // kind, so anyone could execute a later passed proposal first and make an
        // earlier passed one (say, the restart after an emergency) unexecutable.
        // What actually needs ordering is an action whose older value would
        // REINSTATE a superseded decision:
        //   * SetRound — `set_round` resets `minted_this_round`, so an older round
        //     landing after a newer one revives a dead decision and its cap.
        //   * set_guardian — an older guardian landing after a newer one.
        //   * ArmSwapOperator — an older pending key landing after a newer one.
        // Each refuses if a LATER proposal already executed the same kind. The
        // rest need no ordering: `tighten_sweep` is monotone (most restrictive
        // wins, in any order), and a stale `restart` is refused by MINT itself
        // when the stop it would lift is newer than this proposal.
        let id = p.id;
        let cfg = &mut ctx.accounts.config;
        let mut calls: Vec<Vec<u8>> = Vec::new();
        for a in p.actions.iter() {
            match a {
                ProposalAction::SetRound { opens_at, closes_at, price, cap } => {
                    // And it may not install a round that is already over.
                    require!(*closes_at > now, GovError::RoundAlreadyOver);
                    require!(id > cfg.last_round_id, GovError::ProposalSuperseded);
                    cfg.last_round_id = id;
                    let mut d = IX_SET_ROUND.to_vec();
                    d.extend_from_slice(&opens_at.to_le_bytes());
                    d.extend_from_slice(&closes_at.to_le_bytes());
                    d.extend_from_slice(&price.to_le_bytes());
                    d.extend_from_slice(&cap.to_le_bytes());
                    calls.push(d);
                }
                ProposalAction::Brakes { restart_sales, restart_sweep, set_guardian, guardian } => {
                    // The guardian change goes FIRST, so a proposal that replaces a
                    // compromised guardian and restarts sales never has a moment
                    // where the old key could stop the restarted sale.
                    if *set_guardian {
                        require!(id > cfg.last_guardian_id, GovError::ProposalSuperseded);
                        cfg.last_guardian_id = id;
                        let mut d = IX_SET_GUARDIAN.to_vec();
                        d.extend_from_slice(&guardian.try_to_vec()?);
                        calls.push(d);
                    }
                    if *restart_sales || *restart_sweep {
                        let mut d = IX_RESTART.to_vec();
                        d.push(u8::from(*restart_sales));
                        d.push(u8::from(*restart_sweep));
                        d.extend_from_slice(&p.created_at.to_le_bytes());
                        calls.push(d);
                    }
                }
                ProposalAction::TightenSweep(t) => {
                    let mut d = IX_TIGHTEN_SWEEP.to_vec();
                    d.extend_from_slice(&t.try_to_vec()?);
                    calls.push(d);
                }
                ProposalAction::ArmSwapOperator { operator } => {
                    require!(id > cfg.last_arm_id, GovError::ProposalSuperseded);
                    cfg.last_arm_id = id;
                    let mut d = IX_ARM_SWAP_OPERATOR.to_vec();
                    d.extend_from_slice(operator.as_ref());
                    calls.push(d);
                }
            }
        }
        p.executed = true;
        // Every action is a CPI in THIS instruction: one fails, all revert.
        for data in calls {
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
        }
        emit!(ProposalExecuted { id, yes: p.yes, no: p.no,
            quorum_supply: p.quorum_supply, minted_now: m.minted_total });
        Ok(())
    }
}

/// The fields of MINT's config GOV reads, all from one pinned read.
struct MintView {
    governance: Pubkey,
    minted_total: u64,
    bare_retired: u64,
    charter_closes_at: i64,
    sol_reserve: u64,
    max_sweep: u64,
    cooldown: i64,
}

/// MINT's config, PINNED by address, owner, discriminator AND version. One
/// reader, used by both the instruction that snapshots the divisor and the one
/// that spends it, so the two cannot drift into reading the account differently.
fn read_mint_config(acc: &UncheckedAccount) -> Result<MintView> {
    let (expected, _) = Pubkey::find_program_address(&[b"mint-config"], &MINT_PROGRAM_ID);
    require_keys_eq!(acc.key(), expected, GovError::BadMintConfig);
    require_keys_eq!(*acc.owner, MINT_PROGRAM_ID, GovError::BadMintConfig);
    let d = acc.try_borrow_data()?;
    require!(d.len() >= OFF_MINT_BARE_RETIRED + 8, GovError::BadMintConfig);
    require!(d[..8] == MINT_CONFIG_DISC, GovError::BadMintConfig);
    require!(d[OFF_MINT_VERSION] == MINT_CONFIG_VERSION, GovError::BadMintConfig);
    let u = |o: usize| u64::from_le_bytes(d[o..o + 8].try_into().unwrap());
    let mut g = [0u8; 32]; g.copy_from_slice(&d[OFF_MINT_GOVERNANCE..OFF_MINT_GOVERNANCE + 32]);
    Ok(MintView {
        governance: Pubkey::new_from_array(g),
        minted_total: u(OFF_MINT_MINTED_TOTAL),
        bare_retired: u(OFF_MINT_BARE_RETIRED),
        charter_closes_at: u(OFF_MINT_CHARTER_CLOSES) as i64,
        sol_reserve: u(OFF_MINT_SOL_RESERVE),
        max_sweep: u(OFF_MINT_MAX_SWEEP),
        cooldown: u(OFF_MINT_COOLDOWN) as i64,
    })
}

/// BURN's `burned_total`, pinned by address, owner, discriminator and version.
fn read_burn_total(acc: &UncheckedAccount) -> Result<u64> {
    let (expected, _) = Pubkey::find_program_address(&[b"burn-config"], &BURN_PROGRAM_ID);
    require_keys_eq!(acc.key(), expected, GovError::BadBurnConfig);
    require_keys_eq!(*acc.owner, BURN_PROGRAM_ID, GovError::BadBurnConfig);
    let d = acc.try_borrow_data()?;
    require!(d.len() >= OFF_BURN_TOTAL + 8, GovError::BadBurnConfig);
    require!(d[..8] == BURN_CONFIG_DISC, GovError::BadBurnConfig);
    require!(d[OFF_BURN_VERSION] == BURN_CONFIG_VERSION, GovError::BadBurnConfig);
    Ok(u64::from_le_bytes(d[OFF_BURN_TOTAL..OFF_BURN_TOTAL + 8].try_into().unwrap()))
}

/// A vault's mint index from MINT's `VaultRecord`, pinned by the PDA derivation
/// (["vault", asset] under MINT), owner, discriminator, version, and the asset
/// written inside it. Every vault has one; a vault without one cannot vote.
fn read_vault_index(acc: &UncheckedAccount, asset: &Pubkey) -> Result<u64> {
    let (expected, _) = Pubkey::find_program_address(&[b"vault", asset.as_ref()], &MINT_PROGRAM_ID);
    require_keys_eq!(acc.key(), expected, GovError::BadVaultRecord);
    require_keys_eq!(*acc.owner, MINT_PROGRAM_ID, GovError::BadVaultRecord);
    let d = acc.try_borrow_data()?;
    require!(d.len() >= OFF_REC_INDEX + 8, GovError::BadVaultRecord);
    require!(d[..8] == VAULT_RECORD_DISC, GovError::BadVaultRecord);
    require!(d[OFF_REC_VERSION] == VAULT_RECORD_VERSION, GovError::BadVaultRecord);
    let mut a = [0u8; 32]; a.copy_from_slice(&d[OFF_REC_ASSET..OFF_REC_ASSET + 32]);
    require_keys_eq!(Pubkey::new_from_array(a), *asset, GovError::BadVaultRecord);
    Ok(u64::from_le_bytes(d[OFF_REC_INDEX..OFF_REC_INDEX + 8].try_into().unwrap()))
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
    /// FIRST, at a fixed offset, for the same reason SEAL and MINT declare one.
    pub version: u8,
    pub collection: Pubkey,
    pub quorum_bps: u16,
    pub threshold_bps: u16,
    pub min_voting_secs: i64,
    pub proposal_count: u64,
    pub bump: u8,
    /// Per-kind ordering marks (stage 3b): the id of the latest executed proposal
    /// carrying a SetRound / a guardian change / an operator arm. See
    /// `execute_proposal`.
    pub last_round_id: u64,
    pub last_guardian_id: u64,
    pub last_arm_id: u64,
}

/// One thing a ratified proposal does. A proposal carries up to `MAX_ACTIONS` of
/// them, at most one of each kind.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum ProposalAction {
    /// When the next round opens and closes, its price, and its cap.
    /// `price` is in the payment mint's base units (sats of cbBTC), >= 21,000.
    SetRound { opens_at: i64, closes_at: i64, price: u64, cap: u32 },
    /// Lift the guardian's stops, and/or replace the guardian (`None` retires the
    /// brake). The guardian can only STOP; this is the only way back.
    Brakes { restart_sales: bool, restart_sweep: bool, set_guardian: bool, guardian: Option<Pubkey> },
    /// Make the swap hop smaller. Each field may only tighten.
    TightenSweep(SweepTighten),
    /// Arm a replacement swap operator; MINT lands it after seven days' notice.
    ArmSwapOperator { operator: Pubkey },
}

impl ProposalAction {
    fn kind(&self) -> usize {
        match self {
            ProposalAction::SetRound { .. } => 0,
            ProposalAction::Brakes { .. } => 1,
            ProposalAction::TightenSweep(_) => 2,
            ProposalAction::ArmSwapOperator { .. } => 3,
        }
    }
}

/// MUST match MINT's `SweepTighten` field for field. A second copy of a fact,
/// because GOV cannot depend on MINT's crate; the suite proves they agree by
/// executing a ratified `TightenSweep` end to end.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct SweepTighten {
    pub sol_reserve_lamports: Option<u64>,
    pub max_sweep_lamports: Option<u64>,
    pub sweep_cooldown_secs: Option<i64>,
}

#[account]
pub struct Proposal {
    pub id: u64,
    pub actions: Vec<ProposalAction>,
    pub voting_ends_at: i64,
    pub yes: u64,
    pub no: u64,
    pub executed: bool,
    pub bump: u8,
    /// LIVE supply (minted - burned) at the instant this proposal was created.
    /// The quorum divisor.
    pub quorum_supply: u64,
    /// The tally rule as it stood when this proposal opened. See create_proposal.
    pub quorum_bps: u16,
    pub threshold_bps: u16,
    /// MINT's `minted_total` at creation: only vaults with a lower mint index vote.
    pub index_snapshot: u64,
    /// When this proposal was created. MINT's `restart` refuses to lift a stop
    /// the guardian pulled AFTER this.
    pub created_at: i64,
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
    #[account(init, payer = authority, space = 8 + 1 + 32 + 2 + 2 + 8 + 8 + 1 + 8 + 8 + 8 + CONFIG_PADDING, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, GovConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GovConfig>,
    #[account(init, payer = proposer, space = 8 + 8 + ACTIONS_SPACE + 8 + 8 + 8 + 1 + 1 + 8 + 2 + 2 + 8 + 8,
        seeds = [PROPOSAL_SEED, &(config.proposal_count + 1).to_le_bytes()], bump)]
    pub proposal: Account<'info, Proposal>,
    /// CHECK: MINT's config PDA; verified in-handler. Read-only here — the
    /// quorum divisor is snapshotted from it and nothing is written.
    pub mint_config: UncheckedAccount<'info>,
    /// CHECK: BURN's config PDA; verified in-handler. Live supply = minted - burned.
    pub burn_config: UncheckedAccount<'info>,
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
    /// CHECK: MINT's VaultRecord for `vault_asset`; verified in-handler.
    pub vault_record: UncheckedAccount<'info>,
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
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

#[event] pub struct ProposalCreated { pub id: u64, pub proposer: Pubkey, pub actions: Vec<ProposalAction>, pub voting_ends_at: i64, pub quorum_supply: u64 }
#[event] pub struct VoteCast { pub proposal: Pubkey, pub asset: Pubkey, pub voter: Pubkey, pub support: bool, pub yes: u64, pub no: u64 }
#[event] pub struct ProposalExecuted { pub id: u64, pub yes: u64, pub no: u64, pub quorum_supply: u64, pub minted_now: u64 }

#[error_code]
pub enum GovError {
    #[msg("only the designated init authority may initialize")] NotTheInitAuthority,
    #[msg("account is not a Metaplex Core AssetV1")] NotACoreAsset,
    #[msg("signer is not the current owner of this vault")] NotTheOwner,
    #[msg("this asset does not belong to the CBOB vault collection")] ForeignVault,
    #[msg("voting has closed on this proposal")] VotingClosed,
    #[msg("voting is still open")] VotingOpen,
    #[msg("this proposal has already been executed")] AlreadyExecuted,
    #[msg("quorum was not met against the live supply snapshotted when the proposal opened")] QuorumNotMet,
    #[msg("the YES share did not reach the threshold")] ThresholdNotMet,
    #[msg("bad voting or round window")] BadWindow,
    #[msg("quorum/threshold out of range")] BadThreshold,
    #[msg("the mint config account is not the MINT program's config")] BadMintConfig,
    #[msg("the MINT program does not name this program as its governance authority")] NotTheGovernanceAuthority,
    #[msg("this proposal passed but was not executed inside the execution window; vote again")] ProposalExpired,
    #[msg("the round this proposal would set has already closed")] RoundAlreadyOver,
    #[msg("a later proposal of the same kind has already been executed; this one is superseded")] ProposalSuperseded,
    #[msg("this proposal would do nothing")] EmptyAction,
    #[msg("numeric overflow")] Overflow,
    #[msg("the burn config account is not the BURN program's config")] BadBurnConfig,
    #[msg("the vault record is not MINT's record for this vault")] BadVaultRecord,
    #[msg("this vault was minted after the proposal opened and may not vote on it")] VaultTooNew,
    #[msg("a voted round may not be priced below 21,000 sats")] PriceBelowFloor,
    #[msg("no proposal may be created before the charter window closes")] CharterNotClosed,
    #[msg("YES votes did not reach 10% of the live supply snapshotted when the proposal opened")] TurnoutTooLow,
    #[msg("a proposal carries at most four actions")] TooManyActions,
    #[msg("a proposal carries at most one action of each kind")] DuplicateAction,
    #[msg("a vote may only tighten the swap sweep")] Loosening,
}
