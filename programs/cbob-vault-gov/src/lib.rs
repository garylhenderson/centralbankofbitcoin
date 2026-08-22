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
//! QUORUM IS MEASURED AGAINST SUPPLY EVER MINTED, snapshotted into the proposal
//! at creation from MINT's `minted_total`.
//!
//! It said "LIVE SUPPLY" until round 6 and that was wrong twice over. `minted_total`
//! never decrements, so every burned vault keeps counting toward the bar while
//! its vote is gone — enough burns and governance freezes for good, which is why
//! `quorum_bps` is now the one parameter `update_gov_config` may LOWER. And it was
//! read at EXECUTE time, so the divisor moved while people were voting: minting
//! during a proposal bought quorum (each new vault is a whole vote and only a
//! fraction of a vote's worth of bar), and minting after voting closed but before
//! execution could push a proposal that had already won back below the line.
//! Round 7 snapshotted it and round 8 found the snapshot froze the WRONG
//! direction: a proposal opened just after the charter round carried a divisor
//! of ~190 and could be executed a month later against 2,100 live vaults. The
//! divisor is now `max(snapshot, live)`, so the bar only ever rises with supply
//! that really exists and a mint can only make a proposal HARDER to pass.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

declare_id!("2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2");

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
pub const MINT_PROGRAM_ID: Pubkey = pubkey!("Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo");
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
/// minted_total[205..213] max_supply[213..221] bank_treasury[221..253]
/// split_bps[253..255] paused[255] swap_operator[256..288]
/// sol_reserve_lamports[288..296] bump[296] then round-6 fields.
/// (This map said `bump[221]` until round 6. Nothing read it, but a wrong map
/// beside a correct constant is how the next reader gets it wrong.)
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
/// How long an admin rotation sits in public before it takes effect.
const ROTATION_NOTICE_SECS: i64 = 7 * 24 * 3600;
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
/// of exactly the value nothing else checks.
pub const GOV_CONFIG_VERSION: u8 = 1;

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
        require!(quorum_bps >= MIN_QUORUM_BPS && quorum_bps <= 10_000, GovError::BadThreshold);
        // A simple majority of votes cast is the floor; anything less lets a
        // minority of a quorum carry a round.
        require!(threshold_bps > 5_000 && threshold_bps <= MAX_THRESHOLD_BPS, GovError::BadThreshold);
        require!((MIN_VOTING_SECS_FLOOR..=MAX_VOTING_SECS).contains(&min_voting_secs), GovError::BadWindow);
        let c = &mut ctx.accounts.config;
        c.version = GOV_CONFIG_VERSION;
        c.min_voting_secs = min_voting_secs;
        c.admin = ctx.accounts.admin.key();
        c.collection = collection;
        c.quorum_bps = quorum_bps;
        c.threshold_bps = threshold_bps;
        c.proposal_count = 0;
        c.last_executed_id = 0;
        c.pending_admin = Pubkey::default();
        c.pending_admin_at = 0;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Tighten the governance parameters. RATCHET ONLY, admin.
    ///
    /// It exists because `admin` was a field this program WROTE AND NEVER READ —
    /// the same shape as `minted_total` in round 5, which was incremented on
    /// every mint while the attack its own doc comment described went unstopped.
    /// Worse, nothing could change `min_voting_secs` at all: initialize with the
    /// 60-second testing floor by accident and governance is permanently capturable
    /// by whoever is awake, with no remedy short of upgrading the program.
    ///
    /// `min_voting_secs` and `threshold_bps` MAY ONLY MOVE IN THE SAFER DIRECTION.
    /// Longer voting, higher YES threshold. So neither is a capture tool: an admin
    /// key that turns hostile cannot use them to lower the bar on a vote it wants.
    ///
    /// `quorum_bps` IS THE EXCEPTION, and the exception is deliberate. The
    /// divisor is `max(snapshot, live supply)`, which never decreases, while the
    /// voting population shrinks with every burn — so a quorum that could only
    /// ratchet up is a governance system with an expiry date. Being able to lower
    /// it is the only remedy for that.
    ///
    /// ⚠️ THE ORIGINAL JUSTIFICATION HERE WAS WRONG, and round 7 broke on it: it
    /// said an admin hostile enough to lower quorum "can already arm a governance
    /// rotation and BE governance in seven days, which is strictly more powerful".
    /// The rotation is slow, published and alarmed; lowering quorum was atomic. A
    /// power is not comparable to another just because it is larger. What makes
    /// this safe now is that the tally rule is SNAPSHOTTED into each proposal, so
    /// a change here cannot reach a vote that has already been cast, and
    /// `MIN_QUORUM_BPS` stops it reaching a number that needs one vote.
    pub fn update_gov_config(
        ctx: Context<UpdateGovConfig>,
        quorum_bps: Option<u16>,
        threshold_bps: Option<u16>,
        min_voting_secs: Option<i64>,
        admin: Option<Pubkey>,
    ) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(x) = quorum_bps {
            require!(x >= MIN_QUORUM_BPS && x <= 10_000, GovError::BadThreshold);
            c.quorum_bps = x;
        }
        if let Some(x) = threshold_bps {
            // Ratchets UP, but not to deadlock. See MAX_THRESHOLD_BPS.
            require!(x >= c.threshold_bps && x <= MAX_THRESHOLD_BPS, GovError::BadThreshold);
            c.threshold_bps = x;
        }
        if let Some(x) = min_voting_secs {
            require!(x >= c.min_voting_secs && x <= MAX_VOTING_SECS, GovError::BadWindow);
            c.min_voting_secs = x;
        }
        // ADMIN WAITS HERE TOO. This is the key that can move `quorum_bps`, and
        // it rotated on a single signature while MINT's equivalent was
        // timelocked — the round-7 finding, left standing in the program where
        // the consequence is who may set a round.
        if let Some(x) = admin {
            require_keys_neq!(x, Pubkey::default(), GovError::BadThreshold);
            c.pending_admin = x;
            c.pending_admin_at = Clock::get()?.unix_timestamp
                .checked_add(ROTATION_NOTICE_SECS).ok_or(GovError::Overflow)?;
        }
        emit!(GovConfigUpdated { quorum_bps: c.quorum_bps, threshold_bps: c.threshold_bps,
            min_voting_secs: c.min_voting_secs, admin: c.admin });
        Ok(())
    }

    /// Land an admin rotation the notice period has released.
    pub fn apply_pending_admin(ctx: Context<ApplyPendingAdmin>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_admin, Pubkey::default(), GovError::BadThreshold);
        require!(now >= c.pending_admin_at, GovError::BadWindow);
        c.admin = c.pending_admin;
        c.pending_admin = Pubkey::default();
        c.pending_admin_at = 0;
        Ok(())
    }

    /// Disarm it. The CURRENT admin.
    pub fn cancel_pending_admin(ctx: Context<UpdateGovConfig>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_admin, Pubkey::default(), GovError::BadThreshold);
        c.pending_admin = Pubkey::default();
        c.pending_admin_at = 0;
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
        // THE QUORUM DIVISOR IS FIXED HERE, not at execute. See the header.
        let quorum_supply = read_mint_config(&ctx.accounts.mint_config)?.1;
        let (owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
        require_keys_eq!(owner, ctx.accounts.proposer.key(), GovError::NotTheOwner);
        require_keys_eq!(collection, ctx.accounts.config.collection, GovError::ForeignVault);

        let now = Clock::get()?.unix_timestamp;
        let dur = voting_ends_at.checked_sub(now).ok_or(GovError::BadWindow)?;
        require!(dur >= ctx.accounts.config.min_voting_secs && dur <= MAX_VOTING_SECS, GovError::BadWindow);
        // Refuse a proposal MINT would reject anyway — otherwise a month of voting
        // ends in an execute that cannot land.
        require!(closes_at > opens_at, GovError::BadWindow);
        // checked_sub, not `-`. The workspace sets `overflow-checks = true`, so a
        // raw subtraction here ABORTS rather than wrapping — but that puts the
        // one-year bound's safety in a Cargo profile that a future edit could drop
        // silently. A bound worth having is worth enforcing in the code that
        // states it.
        require!(closes_at.checked_sub(opens_at).ok_or(GovError::BadWindow)? <= MAX_ROUND_SECS,
            GovError::BadWindow);
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
        p.quorum_supply = quorum_supply;
        // THE RULE IS SNAPSHOTTED WITH THE DIVISOR.
        //
        // Round 6 froze `quorum_supply` and left `quorum_bps` and `threshold_bps`
        // read LIVE at execute — and in the same round made `quorum_bps` lowerable
        // by admin alone, immediately. Together those were one signature and one
        // vault away from ratifying anything: create a proposal, vote your own
        // vault YES, then lower quorum to 1 in the same block as the execute. The
        // defence written down for the lowerable quorum ("an admin hostile enough
        // to do this can already arm a governance rotation and BE governance in
        // seven days") was wrong in the dimension that decides it: the rotation is
        // slow, published, and alarmed; this was atomic and reported up to thirty
        // minutes later, after the free mint.
        //
        // A tally rule applied retroactively to votes already cast under a
        // different rule is not a rule. Both are fixed here, where everyone can
        // see them before they vote.
        p.quorum_bps = ctx.accounts.config.quorum_bps;
        p.threshold_bps = ctx.accounts.config.threshold_bps;
        emit!(ProposalCreated { id: p.id, proposer: owner, opens_at, closes_at, price_lamports, cap, voting_ends_at, quorum_supply });
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

    /// Ratify. Quorum is measured against the supply SNAPSHOTTED INTO THE PROPOSAL
    /// when it was created — see the header. It was read live here until round 6,
    /// under a comment claiming that "tracks real supply"; it tracked cumulative
    /// issuance, and it moved while people were voting.
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now >= ctx.accounts.proposal.voting_ends_at, GovError::VotingOpen);
        require!(!ctx.accounts.proposal.executed, GovError::AlreadyExecuted);
        // A passed proposal is not a bearer instrument. See EXECUTION_WINDOW_SECS.
        require!(now <= ctx.accounts.proposal.voting_ends_at
            .checked_add(EXECUTION_WINDOW_SECS).ok_or(GovError::Overflow)?, GovError::ProposalExpired);
        // And it may not install a round that is already over. MINT accepts one
        // (it only checks closes_at > opens_at), and installing a dead round
        // would clobber a live one and stop the sale on a technicality.
        require!(ctx.accounts.proposal.closes_at > now, GovError::RoundAlreadyOver);

        // confirm THIS program is still MINT's governance authority
        let (gov_pda, gov_bump) = Pubkey::find_program_address(&[GOV_SEED], &crate::ID);
        let (governance, minted_now) = read_mint_config(&ctx.accounts.mint_config)?;
        // If MINT does not name us, the CPI below would fail anyway — say so
        // clearly instead of surfacing a ConstraintHasOne from another program.
        require_keys_eq!(governance, gov_pda, GovError::NotTheGovernanceAuthority);

        let p = &mut ctx.accounts.proposal;
        let cast = (p.yes as u128) + (p.no as u128);
        require!(cast > 0, GovError::QuorumNotMet);
        // quorum: votes cast vs the supply SNAPSHOTTED WHEN THE PROPOSAL OPENED.
        // Reading it here instead let anyone who could mint move the bar under an
        // open vote, in either direction.
        // THE DIVISOR IS THE LARGER OF THE SNAPSHOT AND LIVE SUPPLY.
        //
        // Round 6 froze `quorum_supply` to stop minting LOWERING the bar under an
        // open vote, and froze the wrong direction. A voting window may be 30 days
        // and the execution window adds 7, so a proposal opened the day after the
        // ~190-vault charter round carries a divisor of 190 and can be executed a
        // month later against a live supply of 2,100: the 21% holder alone clears
        // `need = 38` with their own 40 vaults. And forwards, a vault minted
        // during the window added a whole vote and ZERO bar, which made buying
        // votes strictly cheaper than before the snapshot.
        //
        // `max` closes the STALE-SNAPSHOT attack completely and breaks no
        // liveness: the bar only ever rises with supply that really exists and
        // the PERCENTAGE is still the one the proposal opened under. It also
        // makes `minted_now` load-bearing; it was read and used for nothing but
        // an event field, the assigned-and-never-read shape this project has
        // been burned by twice.
        //
        // ⚠️ WHAT IT DOES NOT DO, stated because round 8's comment here claimed
        // it did. Minting during a voting window is still PROFITABLE for someone
        // who votes the new vaults: N mints raise the divisor by N and the bar by
        // N * quorum_bps / 10_000 while adding N whole votes — net positive at
        // any quorum below 100%. It is strictly less profitable than before the
        // snapshot and it is no longer free, and that is the whole of the claim.
        // THE CONTROL ON MINTING IS THE BANK CO-SIGNATURE: a written duty to
        // refuse mints while a proposal's voting window is open, not an on-chain
        // rule, because a Core asset carries no creation slot to check against.
        // The alarm watches `mint.minted_total` and `gov.proposal_count`, so
        // neither half of that is silent.
        let divisor = core::cmp::max(p.quorum_supply, minted_now);
        // CEILING, and never zero. Flooring meant `supply * bps < 10_000` produced
        // `need = 0` — so with quorum at 1 bp and 190 vaults the only surviving
        // requirement was `cast > 0`, and one vault carried the vote. A quorum
        // that rounds down to nothing is not a quorum.
        let need = (divisor as u128)
            .checked_mul(p.quorum_bps as u128).ok_or(GovError::Overflow)?
            .checked_add(9_999).ok_or(GovError::Overflow)? / 10_000u128;
        require!(need > 0, GovError::QuorumNotMet);
        require!(cast >= need, GovError::QuorumNotMet);
        // threshold: YES share of votes cast
        let yes_bps = (p.yes as u128).checked_mul(10_000).ok_or(GovError::Overflow)? / cast;
        require!(yes_bps >= p.threshold_bps as u128, GovError::ThresholdNotMet);

        // ONLY FORWARD. N proposals can pass at once and each `set_round` resets
        // `minted_this_round`, so executing an older one after a newer one both
        // reinstates a superseded decision and hands the round its cap again.
        // Governance is a sequence of decisions, and the last one is the decision.
        require!(p.id > ctx.accounts.config.last_executed_id, GovError::ProposalSuperseded);

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
        let executed_id = p.id;
        emit!(ProposalExecuted { id: executed_id, yes: p.yes, no: p.no,
            quorum_supply: p.quorum_supply, minted_now });
        ctx.accounts.config.last_executed_id = executed_id;
        Ok(())
    }
}

/// Returns (governance, minted_total) from MINT's config, PINNED by address,
/// owner, discriminator AND version. One reader, used by both the instruction
/// that snapshots the divisor and the one that spends it, so the two cannot
/// drift into reading the account differently.
fn read_mint_config(acc: &UncheckedAccount) -> Result<(Pubkey, u64)> {
    let (expected, _) = Pubkey::find_program_address(&[b"mint-config"], &MINT_PROGRAM_ID);
    require_keys_eq!(acc.key(), expected, GovError::BadMintConfig);
    require_keys_eq!(*acc.owner, MINT_PROGRAM_ID, GovError::BadMintConfig);
    let d = acc.try_borrow_data()?;
    require!(d.len() >= OFF_MINT_MINTED_TOTAL + 8, GovError::BadMintConfig);
    require!(d[..8] == MINT_CONFIG_DISC, GovError::BadMintConfig);
    require!(d[OFF_MINT_VERSION] == MINT_CONFIG_VERSION, GovError::BadMintConfig);
    let mut g = [0u8; 32]; g.copy_from_slice(&d[OFF_MINT_GOVERNANCE..OFF_MINT_GOVERNANCE + 32]);
    let mut t = [0u8; 8]; t.copy_from_slice(&d[OFF_MINT_MINTED_TOTAL..OFF_MINT_MINTED_TOTAL + 8]);
    Ok((Pubkey::new_from_array(g), u64::from_le_bytes(t)))
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
    pub admin: Pubkey,
    pub collection: Pubkey,
    pub quorum_bps: u16,
    pub threshold_bps: u16,
    pub min_voting_secs: i64,
    pub proposal_count: u64,
    pub bump: u8,
    /// The highest proposal id ever executed. Execution only moves forward.
    pub last_executed_id: u64,
    /// An admin rotation waiting out `ROTATION_NOTICE_SECS`.
    pub pending_admin: Pubkey,
    pub pending_admin_at: i64,
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
    /// MINT's `minted_total` at the instant this proposal was created.
    pub quorum_supply: u64,
    /// The tally rule as it stood when this proposal opened. See create_proposal.
    pub quorum_bps: u16,
    pub threshold_bps: u16,
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
    #[account(init, payer = admin, space = 8 + 1 + 32 + 32 + 2 + 2 + 8 + 8 + 1 + 8 + 32 + 8, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, GovConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApplyPendingAdmin<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GovConfig>,
}

#[derive(Accounts)]
pub struct UpdateGovConfig<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, GovConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GovConfig>,
    #[account(init, payer = proposer, space = 8 + 8 + 8 + 8 + 8 + 4 + 8 + 8 + 8 + 1 + 1 + 8 + 2 + 2,
        seeds = [PROPOSAL_SEED, &(config.proposal_count + 1).to_le_bytes()], bump)]
    pub proposal: Account<'info, Proposal>,
    /// CHECK: MINT's config PDA; verified in-handler. Read-only here — the
    /// quorum divisor is snapshotted from it and nothing is written.
    pub mint_config: UncheckedAccount<'info>,
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

#[event] pub struct ProposalCreated { pub id: u64, pub proposer: Pubkey, pub opens_at: i64, pub closes_at: i64, pub price_lamports: u64, pub cap: u32, pub voting_ends_at: i64, pub quorum_supply: u64 }
#[event] pub struct VoteCast { pub proposal: Pubkey, pub asset: Pubkey, pub voter: Pubkey, pub support: bool, pub yes: u64, pub no: u64 }
#[event] pub struct ProposalExecuted { pub id: u64, pub yes: u64, pub no: u64, pub quorum_supply: u64, pub minted_now: u64 }
#[event] pub struct GovConfigUpdated { pub quorum_bps: u16, pub threshold_bps: u16, pub min_voting_secs: i64, pub admin: Pubkey }

#[error_code]
pub enum GovError {
    #[msg("only the designated init authority may initialize")] NotTheInitAuthority,
    #[msg("account is not a Metaplex Core AssetV1")] NotACoreAsset,
    #[msg("signer is not the current owner of this vault")] NotTheOwner,
    #[msg("this asset does not belong to the CBOB vault collection")] ForeignVault,
    #[msg("voting has closed on this proposal")] VotingClosed,
    #[msg("voting is still open")] VotingOpen,
    #[msg("this proposal has already been executed")] AlreadyExecuted,
    #[msg("quorum was not met against the larger of the proposal's snapshot and live supply")] QuorumNotMet,
    #[msg("the YES share did not reach the threshold")] ThresholdNotMet,
    #[msg("bad voting or round window")] BadWindow,
    #[msg("quorum/threshold out of range")] BadThreshold,
    #[msg("the mint config account is not the MINT program's config")] BadMintConfig,
    #[msg("the MINT program does not name this program as its governance authority")] NotTheGovernanceAuthority,
    #[msg("this proposal passed but was not executed inside the execution window; vote again")] ProposalExpired,
    #[msg("the round this proposal would set has already closed")] RoundAlreadyOver,
    #[msg("a later proposal has already been executed; this one is superseded")] ProposalSuperseded,
    #[msg("numeric overflow")] Overflow,
}
