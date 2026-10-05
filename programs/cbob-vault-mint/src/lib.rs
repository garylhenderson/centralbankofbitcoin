//! CBOB Vault MINT — the only way a vault is created, and the only thing the
//! governors can steer.
//!
//! GOVERNANCE SCOPE IS DELIBERATELY TINY: a ratified vote sets **when** a round
//! opens and **what it costs**. That is the whole parameter space. A hostile
//! majority cannot express a dangerous proposal because the instruction has
//! nowhere to put one — no plugin set, no seal, no redemption rule. And existing
//! vaults are untouchable regardless: permanent plugins are create-only, so no
//! vote can ever reach backwards into a vault already minted.
//!
//! The plugin set below is HARDCODED and ungovernable. That is the point.
//!
//! v6 (Gary, 2026-10-03): THERE IS NO BANK AND NO ADMIN. `mint_vault` takes the
//! owner's signature and nothing privileged. Every v5 admin power moved to
//! governance or was deleted. The one thing left that is not a vote is the
//! GUARDIAN (Gary's wallet), and its whole surface is three stops, each one-way:
//! `emergency_stop_sales`, `emergency_stop_sweep` and (stage 3c)
//! `cancel_swap_operator`. Only governance can `restart` either, and only
//! governance can replace the guardian (after a week's notice).
//!
//! v6 STAGE 2:
//!   * GOVERNANCE IS THE GOV PROGRAM'S PDA FROM `initialize`. No wallet ever holds
//!     it, not even for a block. The first vaults (and so the first voters) come
//!     from the CHARTER CLAIM, which needs no vote: its window is written once here.
//!   * THE DECK IS GONE. A level is drawn by the PROGRAM, after the mint, from a
//!     slot hash that did not exist when the minter signed (`capture_entropy` +
//!     `reveal_level`). No salt, no root, no ceremony, nobody who knows the deck.
//!   * VOTED ROUNDS ARE PRICED IN cbBTC, with a floor of 21,000 sats.
//!   * ROYALTIES ARE FIXED AT 10% FOREVER (Gary). `initialize` installs the
//!     collection's Royalties plugin with plugin authority NONE, so Core itself
//!     refuses every later update or removal, from anyone, including this program.
//!
//! v6 STAGE 3, THE COMMUNITY POOL (Gary, 2026-10-03: *"the % that goes back to
//! the community should live in the program"*):
//!   * `split_revenue` sends the holders' 85% to a token account owned by THIS
//!     PROGRAM'S CONFIG PDA. There is no distributor wallet, and no vote can point
//!     the 85% anywhere else: no instruction writes the pool address.
//!   * `activate` (permissionless) admits a vault once its own cbBTC account holds
//!     21,000 sats. A sealed vault's balance can only RISE until it is burned, so
//!     activation is permanent for the vault's life and cannot be gamed by funding
//!     for a moment.
//!   * `distribute` (permissionless) moves the pool into a weighted accumulator
//!     (2/3/4/5/6 by level). `claim` (permissionless, batched) pays each vault's
//!     share INTO THAT VAULT'S OWN cbBTC ACCOUNT, which activation proved exists:
//!     a claim never creates an account and the money never passes a wallet.
//!   * A redemption must claim first: BURN calls `retire_redeemed` by CPI, which
//!     refuses while a whole sat is still owed, then removes the vault's weight.
//!     A bare Core burn is retired by anyone with `retire_burned`, which returns
//!     its unclaimed share to the pool.
//!   * Gary, 2026-10-03: *"We can't lock everyone in the lowest level."* A level
//!     is NEVER assigned without real entropy. A missed capture window is
//!     RESCHEDULED to a fresh future slot (`reschedule_reveal`), and every
//!     instruction a member or crank sends anyway (`mint_vault`,
//!     `claim_charter_vault`, `activate`, `claim`) captures for queued vaults it
//!     is handed, so the queue is cranked by ordinary traffic.
//!
//! v6 STAGE 3b (Gary, 2026-10-03, after red-team 1 showed the FIRST charter vault
//! could carry any vote alone): A VOTE ONLY REACHES WHAT MAY SAFELY CHANGE.
//!   * PERMANENT from `initialize`, written by no instruction afterwards: the 85/15
//!     split, the 15% destination (the CBOBTC Squads), the 85% pool, and
//!     `max_supply`. `update_wiring` is deleted.
//!   * The sweep can only be TIGHTENED by a vote (`tighten_sweep`), and a new swap
//!     operator is ARMED by a vote and applied after seven days' notice
//!     (`arm_swap_operator` / `apply_swap_operator`).
//!   * `restart` refuses a restart voted before the stop it would lift.
//!
//! v6 STAGE 3c (Gary, 2026-10-03, red-team 2):
//!   * A NEW GUARDIAN IS ARMED, NOT SET (`arm_guardian` / `apply_guardian`), with
//!     the same public notice as a new swap operator (`notice_secs`, 7 days on
//!     mainnet). GOV refuses either change without YES from half of ALL live
//!     vaults, and never lets the two share a proposal.
//!   * The guardian may CANCEL a pending swap operator (`cancel_swap_operator`).
//!     It is a stop, so it is the guardian's to make.
//!   * A vote can only tighten the sweep INSIDE bounds fixed at `initialize`
//!     (RT2-3: an unbounded tighten locked every royalty lamport for ever).
//!   * AN ACTIVATION JOINS AT THE NEXT DISTRIBUTION (RT2-5). `activate` first
//!     REQUESTS; the vault joins the schedule only once a distribution has run
//!     after the request, and earns from the one after that. Activating and
//!     distributing in one transaction no longer captures the backlog.
//!   * `initialize` refuses a default 15% destination, a payment mint that is not
//!     a SEAL reserve, and a SEAL config naming another collection (RT2-7).
//!   * The charter claim passes any external-plugin accounts through to Core's
//!     burn of the Proof of Burn (RT2-1), so a benign hook on the Giraffish
//!     Moments collection cannot brick a window nobody can reopen.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction, get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT},
    program::{invoke, invoke_signed},
    system_instruction,
    sysvar::{slot_hashes, instructions::{load_current_index_checked, load_instruction_at_checked}},
    hash::hashv,
};

declare_id!("Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo");

/// ═══ THE PROOF OF BURN SET ═══
///
/// Measured on mainnet 2026-10-03: a Proof of Burn is NOT its own mint or its own
/// collection. It is one of exactly 240 Metaplex Core assets ("Proof of Burn #1"
/// .. "#240") inside the SHARED Giraffish Moments collection, alongside other
/// moments. Name and uri are the only on-chain marks, and both are writable by
/// that collection's update authority — a hot wallet, which could also mint a
/// "Proof of Burn #241" at will.
///
/// So identity is pinned by ADDRESS, not by name: `pob_root` is a Merkle root of
/// the 240 asset addresses, written once at `initialize`, and a charter claim must
/// prove its asset is a leaf. A lookalike minted tomorrow is not in the tree. An
/// address can never be re-minted after a burn (suite 9.12/9.13), so a leaf can
/// be spent exactly once, by Core, with no bitmap here.
///
/// Leaf and node are domain-separated (0x00 / 0x01) so a 32-byte leaf can never
/// be replayed as an internal node — the classic second-preimage attack on a
/// Merkle tree that hashes both the same way. Pairs are SORTED, so a proof
/// carries no direction bits and cannot be re-ordered into a different root.
const MERKLE_LEAF_TAG: u8 = 0x00;
const MERKLE_NODE_TAG: u8 = 0x01;
/// 240 leaves is depth 8. A bound at all, because an unbounded proof is unbounded
/// compute and unbounded bytes.
const MAX_POB_PROOF: usize = 16;

fn merkle_leaf(key: &Pubkey) -> [u8; 32] {
    hashv(&[&[MERKLE_LEAF_TAG], key.as_ref()]).to_bytes()
}

fn merkle_root_from(mut node: [u8; 32], proof: &[[u8; 32]]) -> [u8; 32] {
    for sib in proof.iter() {
        node = if node <= *sib {
            hashv(&[&[MERKLE_NODE_TAG], &node, sib]).to_bytes()
        } else {
            hashv(&[&[MERKLE_NODE_TAG], sib, &node]).to_bytes()
        };
    }
    node
}

/// ═══ THE LEVEL DRAW ═══
///
/// A minter signs the mint, chooses the asset keypair, and can simulate before
/// broadcasting, so ANY input they can see at signing time is grindable. The
/// draw therefore uses blockhashes of slots AFTER the mint, which do not exist
/// when they sign, and which they cannot undo once they have paid. Drawn WITHOUT
/// REPLACEMENT from the census still unminted, so the quotas hold exactly by
/// construction.
///
/// THREE SLOT HASHES, FROM THREE DIFFERENT LEADER ROTATIONS (stage 3, after a
/// red-team review of stage 2). A slot leader holds 4 consecutive slots, may skip
/// any of them, and chooses its block's contents, so one slot hash gave ONE
/// leader many tries, not two. `r = sha256(hA || hB || hC || asset)` where A is
/// the first produced slot at or after `reveal_slot`, and B and C are each the
/// first produced slot at least `ENTROPY_GROUP_STRIDE` leader groups after the
/// previous one. Leader groups are aligned to multiples of 4 on mainnet
/// (MEASURED 2026-10-03 with getSlotLeaders: every leader change fell on a
/// multiple of 4, and epoch starts are multiples of 4), so A, B and C are always
/// in three different rotations. ⚠️ THE SAME MEASUREMENT SAW ONE VALIDATOR HOLD
/// TWO ADJACENT ROTATIONS, which is why the stride is two groups, not one — and
/// why "three different leaders" is likely but not guaranteed: the schedule is
/// stake-weighted and nothing on chain can refuse a repeat.
///
/// ⚠️ WHAT THIS DOES AND DOES NOT BUY, stated plainly. The leader of C produces
/// its block KNOWING hA and hB (slot hashes are public the moment they exist), so
/// C's leader can still grind its own block for the outcome it wants — the last
/// contributor to any public-hash scheme always can. What three groups remove is
/// every OTHER leader's influence and the cheap version of C's: an attacker must
/// BE C's leader (a validator can time a mint into its own rotation), and it
/// can skip its own first slot(s) to move C within its 4-slot group or vary its
/// block: a choice among many draws, not a bias (SPEC 26).
/// The residual is an accepted limit in SPEC; a VRF is the only full answer.
///
/// TWO INSTRUCTIONS, BECAUSE TWO DIFFERENT THINGS ARE TIME-LIMITED:
///   * `capture_entropy` copies the vault's slot hash into its record. SlotHashes
///     forgets after 512 slots, so this has a deadline; it is permissionless, any
///     order, and many fit in one transaction.
///   * `reveal_level` spends it, STRICTLY IN MINT ORDER (`revealed_total`). The
///     census a draw sees depends on every draw before it, so a party able to
///     choose the ORDER of two pending reveals would get two outcomes to pick
///     from. FIFO removes the choice. It has no deadline once entropy is captured.
///
/// A MISSED WINDOW IS RESCHEDULED, NEVER DEFAULTED (Gary, 2026-10-03: *"We can't
/// lock everyone in the lowest level."*). Stage 2 gave an uncaptured vault the
/// lowest level left; that punished a holder for a crank that did not run. Now a
/// vault whose entropy nobody captured within `REVEAL_WINDOW_SLOTS` is moved to
/// `reveal_slot = now + REVEAL_LEAD_SLOTS` — a slot that does not exist yet when
/// the reschedule lands, so a reschedule can never pick among hashes anyone can
/// already see — and draws from that. The FIFO waits for it.
///
/// THE RESIDUAL, accepted and written in SPEC: SLOT HASHES ARE PUBLIC, so once a
/// vault's three exist anyone can COMPUTE its draw off chain without capturing it
/// (stage 2's comment saying otherwise was wrong). A minter who dislikes it can decline to
/// capture and hope that NOBODY else does for the whole window; if so, the
/// reschedule is a fresh roll. Every capture-carrying instruction and the crank
/// close that window, and every reschedule logs `CBOB_REVEAL_RESCHEDULED` so the
/// alarm pages on it.
const REVEAL_LEAD_SLOTS: u64 = 16;
/// ~2 minutes. Must stay well inside SlotHashes' 512, minus `MAX_SKIPPED_SLOTS`,
/// so a capture inside the window always finds the slot if the chain produced it.
const REVEAL_WINDOW_SLOTS: u64 = 300;
/// SlotHashes holds the most recent 512 slots and nothing older.
const SLOT_HASHES_MAX: usize = 512;
/// How far past `reveal_slot` a SKIPPED slot may push the real one.
///
/// Solana skips slots, so `reveal_slot` may never exist (round 21). The draw uses
/// the smallest PRODUCED slot in `[reveal_slot, reveal_slot + MAX_SKIPPED_SLOTS]`
/// — deterministic, because which slots the chain produced is settled before this
/// runs and does not change with when it is called.
const MAX_SKIPPED_SLOTS: u64 = 64;
/// Mainnet NUM_CONSECUTIVE_LEADER_SLOTS: a leader rotation is 4 slots, aligned to
/// multiples of 4 (measured; see the draw comment).
const LEADER_GROUP_SLOTS: u64 = 4;
/// B and C are each at least this many leader groups after the previous hash's
/// group (one validator was measured holding two adjacent groups).
const ENTROPY_GROUP_STRIDE: u64 = 2;
/// THE ATTRIBUTE BUDGET (red-team finding 5). `reveal_level` re-sends the whole
/// attribute list (Core replaces it), so a list a mint ACCEPTS must be one a
/// LEGACY reveal transaction can CARRY, or that vault could never take its level
/// and the FIFO would stop at it for good. This bounds the Borsh-serialized list
/// stored at mint (program-written `charter` included, `level` excluded); the
/// suite proves a reveal carrying exactly this many bytes plus the level fits.
const MAX_ATTR_BYTES: usize = 640;
/// THE OPPORTUNISTIC CRANK, BOUNDED. `mint_vault`, `claim_charter_vault`,
/// `activate` and `claim` each accept up to this many queued vault records (after
/// the SlotHashes sysvar) and capture or reschedule each one that is ripe. Bounded
/// so the instruction it rides on always fits the packet; the suite measures the
/// tightest carrier (a charter claim with a mainnet-depth Proof of Burn proof).
const MAX_CRANK: usize = 4;

/// The blockhash of the smallest produced slot in `[want, want + MAX_SKIPPED_SLOTS]`,
/// or `None` if no such slot is in the sysvar (yet, or any more).
///
/// ⚠️ PIN THE ACCOUNT, PARSE DEFENSIVELY, AND FAIL CLOSED. The key is checked
/// against the sysvar id, the declared count is bounded, the buffer is checked to
/// hold what the count claims, and an all-zero hash is refused rather than being
/// fed into a draw as if it were entropy.
///
/// Layout: `u64 count`, then `count` entries of `(u64 slot, [u8; 32] hash)`.
fn blockhash_in_window(acct: &AccountInfo, want: u64) -> Result<Option<([u8; 32], u64)>> {
    require_keys_eq!(acct.key(), slot_hashes::ID, MintError::BadSlotHashes);
    let data = acct.try_borrow_data()?;
    require!(data.len() >= 8, MintError::BadSlotHashes);
    let n = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
    require!(n <= SLOT_HASHES_MAX, MintError::BadSlotHashes);
    require!(data.len() >= 8 + n * 40, MintError::BadSlotHashes);
    let mut best: Option<(u64, [u8; 32])> = None;
    for i in 0..n {
        let off = 8 + i * 40;
        let slot = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
        if slot < want || slot > want.saturating_add(MAX_SKIPPED_SLOTS) { continue; }
        if best.map_or(true, |(b, _)| slot < b) {
            let mut h = [0u8; 32];
            h.copy_from_slice(&data[off + 8..off + 40]);
            require!(h != [0u8; 32], MintError::BadSlotHashes);
            best = Some((slot, h));
        }
    }
    Ok(best.map(|(slot, h)| (h, slot)))
}

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
/// The SEAL PROGRAM. Its `["seal"]` PDA is DERIVED at runtime, never hardcoded —
/// a stale constant would embed a plugin authority the seal program cannot sign,
/// and every vault minted with it would be born permanently frozen with its BTC
/// unreachable by ANY party. Derive it, do not copy it.
pub const SEAL_PROGRAM_ID: Pubkey = pubkey!("9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273");
pub const SEAL_SEED: &[u8] = b"seal";
pub const SEAL_CONFIG_SEED: &[u8] = b"config";
/// Gary's wallet (v6, 2026-10-03). In this program it signs `initialize` and
/// nothing else, ever.
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
/// any of the four programs. Trailing bytes are ignored by Borsh, so this is free
/// until it is needed. It is not a migration path — it is the room to write one in.
const CONFIG_PADDING: usize = 256;
/// The same room on every vault's record. Stage 3 spent 52 of the original 96
/// bytes on the pool state, stage 3c 9 more on the activation request, and the
/// $CBOB boost 25 more (2026-10-04), so the record (and the rent a minter pays
/// for it) has not grown by a byte.
const RECORD_PADDING: usize = 10;
pub const CONFIG_SEED: &[u8] = b"mint-config";
/// Signs CreateV2 as the collection's update authority, so nothing but this
/// program can put an asset into the CBOB collection.
pub const MINT_SEED: &[u8] = b"mint";
/// One record per vault, `["vault", asset]`: its mint index (which GOV reads to
/// refuse a vote from a vault younger than the proposal), its reveal slot,
/// captured entropy and level.
pub const VAULT_SEED: &[u8] = b"vault";
/// 2 since v6 stage 3 (pool state appended); 3 since stage 3c (the activation
/// request, in what was padding); 4 since the $CBOB boost (the boost and the
/// carried share, in what was padding). GOV pins it.
pub const VAULT_RECORD_VERSION: u8 = 4;
/// THE ONE ON-CHAIN ADDRESS FOR ALL PROJECT INCOME.
///
/// Mint prices, secondary royalties, and anything else the project ever earns are
/// pointed here. It is a PDA of this program, so nobody holds its key: value can
/// only leave through `split_revenue` (the enforced 85/15) or
/// `sweep_sol_for_swap` (bounded, operator-signed, stoppable by the guardian).
pub const REVENUE_SEED: &[u8] = b"revenue";
/// ═══ THE COMMUNITY POOL ═══
///
/// The holders' 85% lives in the classic-SPL associated token account of THIS
/// PROGRAM'S CONFIG PDA for the payment mint (cbBTC). The config PDA signs every
/// payout by seeds; nobody holds a key to it. It is the config PDA rather than a
/// separate one because a redemption carries `claim` and every byte counts: the
/// config is already in that transaction, a second authority would not be.
///
/// A vault ACTIVATES at this many sats of the payment mint in its own account.
pub const ACTIVATION_SATS: u64 = 21_000;
/// The Schedule of Vaults (Gary, 2026-08-22): Level I..V weigh 2/3/4/5/6, so a
/// Level V vault receives exactly three times a Level I.
const LEVEL_WEIGHTS: [u64; 5] = [2, 3, 4, 5, 6];
/// Fixed-point scale of the payout accumulator. u128 throughout: 21M BTC in sats
/// (2.1e15) times this (1e12) is 2.1e27, far inside u128 (3.4e38).
const ACC_SCALE: u128 = 1_000_000_000_000;
/// "Nobody waits longer than a month": a distribution is allowed this long after
/// the last one whatever the size, provided it gives at least 1 sat per weight.
/// ═══ WHAT TRIGGERS A DISTRIBUTION (Gary, 2026-10-03, stage 3b) ═══
/// Either the caller BURNS exactly 100 $GARY in the same instruction (an SPL
/// Burn, not a transfer, so the supply really falls), or 30 days have passed
/// since the last distribution ("we do monthly no matter what"), with no burn.
/// This replaces stage 3's emission-minimum / 31-day / 1-sat-per-weight cadence.
pub const GARY_MINT: Pubkey = pubkey!("8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk");
/// 100 $GARY at 9 decimals (decimals pinned against mainnet by the probe).
pub const DISTRIBUTE_BURN_GARY: u64 = 100_000_000_000;
/// The longest the distribution period may be set, and ⚠️ THE VALUE MAINNET MUST
/// BE INITIALIZED WITH: 30 days. The period itself is an `initialize` parameter
/// (`monthly_secs`) for the same reason GOV's voting period and BURN's redemption
/// window are: a month cannot be exercised on a validator, and a branch nobody has
/// run is not one to trust with a payout. The floor only stops a meaningless value.
pub const MONTHLY_SECS: i64 = 30 * 24 * 3600;
const MIN_MONTHLY_SECS: i64 = 60;
/// ═══ THE $CBOB BOOST (Gary, 2026-10-04) ═══
/// "Yes you can upgrade by burning CBOB. We just don't know exactly what yet."
/// He chose a TEMPORARY boost, outside the level census, priced by a Governor
/// vote and off until the first one. So the MECHANISM is fixed here forever and
/// the TERMS are not:
///   * anyone burns `boost_price` $CBOB (an SPL Burn of THE $CBOB mint pinned at
///     `initialize`) for an activated vault, which then weighs `boost_weight`
///     more for the next `boost_epochs` distributions. Its level never changes
///     and the census is untouched.
///   * A vote sets the three terms (`set_boost_terms`), each inside bounds fixed
///     at `initialize`. A price of 0 switches boosts off; a boost already bought
///     keeps the terms it was bought under.
///   * ONE boost per vault at a time.
/// MEASURED IN DISTRIBUTIONS, NOT SECONDS, because the payout accumulator only
/// moves at a distribution: "the next N distributions" is the exact form of "for
/// a while", and makes every expiry exact to the scaled unit.
/// EXPIRY IS EXACT BECAUSE NO DISTRIBUTION MAY RUN PAST AN EXPIRED BOOST, the
/// same rule as `JoinWaitingFirst`: the distribution that ends a boost makes it
/// DUE, and the next distribution is refused (`BoostsExpireFirst`) until every
/// due boost is expired. Expiring is free and anyone's: `claim` does it for every
/// vault it is handed, and the crank claims every boosted vault after every
/// distribution. A due boost therefore expires at exactly the accumulator its
/// last distribution left, with no per-epoch history kept anywhere.
/// The schedule of WHEN boosts end is a ring of counts indexed by epoch; a boost
/// may last at most `BOOST_RING - 1` distributions, so two live end epochs never
/// share a slot.
const BOOST_RING: usize = 64;
/// The widest bounds `initialize` may fix. Neither can be widened by any vote.
const MAX_BOOST_WEIGHT_BOUND: u8 = 12;
const MAX_BOOST_EPOCHS_BOUND: u16 = (BOOST_RING - 1) as u16;
/// Records per `expire_boosts` call, bounded so a batch always fits the packet.
const MAX_EXPIRE_BATCH: usize = 30;
const IX_SPL_BURN: u8 = 8;
/// SPL token account: amount[64..72], state[108] (1 = initialized, 2 = frozen).
const TOKEN_ACCOUNT_LEN: usize = 165;
const TOKEN_STATE_OFF: usize = 108;
const TOKEN_STATE_INITIALIZED: u8 = 1;
const TOKEN_STATE_FROZEN: u8 = 2;
/// SPL Token `Transfer`. Classic SPL only (the payment mint is pinned classic),
/// and it carries no mint account, which a redemption cannot spare.
const IX_TRANSFER: u8 = 3;
pub const EXECUTE_PREFIX: &[u8] = b"mpl-core-execute";
/// THE BURN PROGRAM, and its `burn_vault`, pinned exactly as SEAL pins them:
/// `retire_redeemed` accepts a call only from inside that instruction. The
/// discriminator is asserted against sha256("global:burn_vault") in the suite.
pub const BURN_PROGRAM_ID: Pubkey = pubkey!("8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8");
pub const IX_BURN_VAULT_DISC: [u8; 8] = [150, 115, 145, 83, 24, 135, 83, 99];
const BURN_IX_ASSET_IDX: usize = 0;
/// SPL Token `TransferChecked`.
const IX_TRANSFER_CHECKED: u8 = 12;
pub const SPL_TOKEN_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const ATA_PROGRAM_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/// A classic SPL mint is exactly 82 bytes; `decimals` is byte 44 and
/// `is_initialized` byte 45.
const SPL_MINT_LEN: usize = 82;
const SPL_MINT_DECIMALS_OFF: usize = 44;
const SPL_MINT_INITIALIZED_OFF: usize = 45;

/// SEAL's `Config` layout, PINNED. Anchor disc = sha256("account:Config")[..8],
/// then `version: u8` deliberately declared FIRST so it sits at a fixed offset
/// whatever else is added later.
pub const SEAL_CONFIG_DISC: [u8; 8] = [155, 12, 170, 224, 30, 250, 204, 130];
/// 2 since v6: SEAL dropped `admin` and `bank`, so `collection` moved to 9.
pub const SEAL_CONFIG_VERSION: u8 = 2;
/// This program's own config layout version, read by GOV. 2 since v6; 3 since
/// stage 3 (the pool state is appended, and offset 73 is the pool account where
/// the distributor wallet used to be); 4 since stage 3b; 5 since stage 3c (the
/// pending guardian, the notice, the tighten bounds and the distribution epoch
/// are appended, so no earlier offset moved); 6 since the $CBOB boost (appended).
pub const MINT_CONFIG_VERSION: u8 = 6;
pub const MINT_CONFIG_DISC: [u8; 8] = [168, 252, 88, 182, 219, 205, 39, 53];
const OFF_VERSION: usize = 8;
const OFF_COLLECTION: usize = 9;
/// SEAL's reserve `Vec<Pubkey>` (u32 length, then keys), read at `initialize`.
const OFF_RESERVES: usize = 41;
/// The GOV program. Its ["gov"] PDA is MINT's governance from `initialize` on,
/// derived here, never typed as an address and never a parameter.
pub const GOV_PROGRAM_ID: Pubkey = pubkey!("2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2");
pub const GOV_SEED: &[u8] = b"gov";

/// Core instruction indices, read off SDK-built instructions and asserted
/// against the SDK serializers in the suite.
const IX_CREATE_V2: u8 = 20;
const IX_ADD_COLLECTION_PLUGIN_V1: u8 = 3;
const IX_UPDATE_PLUGIN_V1: u8 = 6;
const IX_BURN_V1: u8 = 12;
const KEY_ASSET_V1: u8 = 1;
const KEY_COLLECTION_V1: u8 = 5;
const UA_DISC_COLLECTION: u8 = 2;
/// Plugin::Royalties is variant 0.
const PLUGIN_ROYALTIES: u8 = 0;
/// RuleSet::None
const RULESET_NONE: u8 = 0;
/// PluginAuthority::None — the plugin is IMMUTABLE: Core refuses every update and
/// every removal, whoever signs. This is what makes "10% forever" a property of
/// Core rather than of this program's instruction list.
const PLUGIN_AUTHORITY_NONE: u8 = 0;
const PLUGIN_AUTHORITY_ADDRESS: u8 = 3;
/// THE ROYALTY, FIXED FOREVER. Gary, 2026-10-03: 10%, the revenue PDA the sole
/// creator at 100%, then the existing on-chain 85/15. There is no instruction
/// anywhere that changes it, and Core would refuse one if there were.
pub const ROYALTY_BPS: u16 = 1_000;
/// Basis points of income that go to VAULT HOLDERS. The remainder goes to
/// `bank_treasury` (the CBOBTC Squads). 8500 = the 85/15 rule.
const DEFAULT_SPLIT_BPS: u16 = 8_500;
const BPS: u64 = 10_000;
const PLUGIN_PERMANENT_FREEZE_EXECUTE: u8 = 17;
const PLUGIN_ATTRIBUTES: u8 = 6;
const MAX_NAME_LEN: usize = 64;
const MAX_URI_LEN: usize = 200;
/// The most attributes a vault ever carries, the program's own included. Bounded
/// so the reveal transaction, which must re-supply the list, always fits.
const MAX_ATTRS: usize = 8;
const MAX_ATTR_STR: usize = 128;
/// SEAL owned this key in v2-v4; it stays reserved so no vault is born claiming
/// to have been redeemed.
const ATTR_REDEMPTION: &str = "redemption";
/// THE PROGRAM OWNS THIS KEY, AND THAT IS THE WHOLE MECHANISM. `attributes` is
/// CALLER-SUPPLIED: without reserving `level` the minter simply types their own.
/// `reveal_level` appends it from the draw, once.
const ATTR_LEVEL: &str = "level";
/// The charter mark, written by `claim_charter_vault` and nobody else: the
/// spent Proof of Burn's address. Once the PoB is burned the vault is the only
/// record that its holder was charter, so the program writes it, not the caller.
const ATTR_CHARTER: &str = "charter";
/// I..V, index 0..4.
const LEVEL_NAMES: [&str; 5] = ["I", "II", "III", "IV", "V"];
/// A round may not run longer than this. `closes_at = i64::MAX` was expressible.
const MAX_ROUND_SECS: i64 = 365 * 24 * 3600;
/// THE ROUND PRICE FLOOR, in the payment mint's base units — satoshis of cbBTC.
/// Gary, 2026-10-03: "21,000 SATS. that's perfect for me." The same number as the
/// activation seed. A vote sets each round's real price at or above it; no vote
/// can make a round free again.
pub const MIN_ROUND_PRICE_SATS: u64 = 21_000;
/// The charter window may not be longer than this. The window itself is an
/// `initialize` parameter: Gary set it at 7 days (2026-10-03, revising 14; the
/// Chairman's charter-claim film says seven). This bound only stops a typo at the
/// one-time `initialize` from leaving the free path open.
const MAX_CHARTER_SECS: i64 = 90 * 24 * 3600;
/// A sweep cooldown longer than this would be its own denial of service.
const MAX_SWEEP_COOLDOWN_SECS: i64 = 7 * 24 * 3600;
/// One second closes the atomic bypass (two sweeps in one transaction share a
/// timestamp). ⚠️ THE DEPLOYED VALUE MUST BE HOURS. The Bank alarm asserts it.
const MIN_SWEEP_COOLDOWN_SECS: i64 = 1;
/// THE LAUNCH WEDGE FLOORS (round 12).
const MAX_INIT_SWEEP_COOLDOWN_SECS: i64 = 24 * 3600;
const MIN_INIT_SWEEP_LAMPORTS: u64 = 1_000_000_000;      // 1 SOL
/// The per-sweep ceiling the business has always STATED, enforced on chain.
const MAX_SWEEP_LAMPORTS: u64 = 50_000_000_000;           // 50 SOL
/// Stage 3b (Gary 2026-10-03): replacing the swap operator is a vote that ARMS a
/// pending key, then public notice, then anyone may apply it. Stage 3c: the same
/// for the guardian. The notice is an `initialize` parameter (`notice_secs`) for
/// the same reason the voting period is: a week cannot be exercised on a
/// validator, and an `apply` nobody has run is not one to trust.
/// ⚠️ THIS IS THE VALUE MAINNET MUST BE INITIALIZED WITH: 7 days.
pub const NOTICE_SECS: i64 = 7 * 24 * 3600;
const MIN_NOTICE_SECS: i64 = 60;
const MAX_NOTICE_SECS: i64 = 30 * 24 * 3600;
/// THE HARD BOUNDS ON A VOTED TIGHTENING (stage 3c, red-team 2 finding 3). Each is
/// written once by `initialize`, inside these absolute limits, and no vote can
/// pass them: the sweep can always move at least `sweep_floor_lamports` every
/// `cooldown_ceiling_secs`, and at most `reserve_ceiling_lamports` is ever held
/// back. Without them a vote of reserve = u64::MAX locked every royalty lamport.
const MIN_SWEEP_FLOOR_LAMPORTS: u64 = 100_000_000;        // 0.1 SOL
const MAX_RESERVE_CEILING_LAMPORTS: u64 = 10_000_000_000; // 10 SOL
/// How many external-plugin accounts a charter claim may pass through to Core's
/// burn of the Proof of Burn (stage 3c, red-team 2 finding 1).
const MAX_POB_EXTRA: usize = 8;
/// Rent exemption for a 0-byte system account. A reserve BETWEEN zero and this
/// wedges every sweep forever.
const RENT_EXEMPT_0_BYTES: u64 = 890_880;

#[program]
pub mod cbob_vault_mint {
    use super::*;

    /// One-time. Signed by INIT_AUTHORITY and by nobody else, ever again.
    ///
    /// GOVERNANCE IS NOT A PARAMETER. It is the GOV program's ["gov"] PDA, derived
    /// here, so no wallet ever holds it — stage 1 needed a temporary holder and a
    /// one-way `handover_governance` because nobody can vote before the first
    /// vaults exist. The charter claim removes that: its window is fixed here, it
    /// needs no vote, and it produces the first voters.
    ///
    /// THE COLLECTION MUST ARRIVE CLEAN AND LEAVE WITH EXACTLY ONE PLUGIN. A Core
    /// collection-level plugin applies to every vault in it, and some plugin kinds
    /// (a permanent burn or transfer delegate) would hand whoever holds their
    /// authority every vault ever minted. So this refuses a collection that carries
    /// ANY plugin, refuses one that has ever minted, requires this program's PDA as
    /// its update authority, and then installs the one plugin it is allowed:
    /// Royalties, 10%, the revenue PDA at 100%, plugin authority NONE.
    pub fn initialize(
        ctx: Context<Initialize>,
        bank_treasury: Pubkey,
        swap_operator: Pubkey,
        guardian: Option<Pubkey>,
        sol_reserve_lamports: u64,
        max_supply: u64,
        max_sweep_lamports: u64,
        sweep_cooldown_secs: i64,
        level_caps: [u32; 5],
        payment_mint: Pubkey,
        pob_collection: Pubkey,
        pob_root: [u8; 32],
        charter_opens_at: i64,
        charter_closes_at: i64,
        monthly_secs: i64,
        notice_secs: i64,
        sweep_floor_lamports: u64,
        cooldown_ceiling_secs: i64,
        reserve_ceiling_lamports: u64,
        max_boost_weight: u8,
        max_boost_epochs: u16,
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.authority.key(), INIT_AUTHORITY, MintError::NotTheInitAuthority);
        // THE $CBOB MINT, ONCE (Gary 2026-10-04: created before the vaults, with
        // nothing released). A real, initialized, classic SPL mint, and neither of
        // the two mints this program already handles, so a $GARY or cbBTC burn can
        // never buy a boost.
        {
            let m = &ctx.accounts.cbob_mint;
            require_keys_eq!(*m.owner, SPL_TOKEN_ID, MintError::BadBoostSetup);
            let d = m.try_borrow_data()?;
            require!(d.len() == SPL_MINT_LEN && d[SPL_MINT_INITIALIZED_OFF] == 1, MintError::BadBoostSetup);
            require_keys_neq!(m.key(), payment_mint, MintError::BadBoostSetup);
            require_keys_neq!(m.key(), GARY_MINT, MintError::BadBoostSetup);
        }
        require!((1..=MAX_BOOST_WEIGHT_BOUND).contains(&max_boost_weight), MintError::BadBoostSetup);
        require!((1..=MAX_BOOST_EPOCHS_BOUND).contains(&max_boost_epochs), MintError::BadBoostSetup);
        require!(max_supply > 0, MintError::BadSupplyCap);
        // RT2-7: the 15% destination is permanent from here, so the default key
        // (an address nobody can sign for, whose ATA nobody would ever create)
        // would make every `split_revenue` fail for ever.
        require_keys_neq!(bank_treasury, Pubkey::default(), MintError::WrongTreasury);
        require!((MIN_NOTICE_SECS..=MAX_NOTICE_SECS).contains(&notice_secs), MintError::BadNotice);
        // THE TIGHTEN BOUNDS (stage 3c). Each must already hold for the values
        // being installed, so the very first vote is judged against a real range.
        require!(sweep_floor_lamports >= MIN_SWEEP_FLOOR_LAMPORTS && sweep_floor_lamports <= max_sweep_lamports,
            MintError::BadSweepBound);
        require!(cooldown_ceiling_secs >= sweep_cooldown_secs && cooldown_ceiling_secs <= MAX_SWEEP_COOLDOWN_SECS,
            MintError::BadSweepBound);
        require!(reserve_ceiling_lamports >= sol_reserve_lamports && reserve_ceiling_lamports >= RENT_EXEMPT_0_BYTES
            && reserve_ceiling_lamports <= MAX_RESERVE_CEILING_LAMPORTS, MintError::BadSweepBound);
        require!(max_sweep_lamports >= MIN_INIT_SWEEP_LAMPORTS && max_sweep_lamports <= MAX_SWEEP_LAMPORTS,
            MintError::BadSweepBound);
        require!((MIN_SWEEP_COOLDOWN_SECS..=MAX_INIT_SWEEP_COOLDOWN_SECS).contains(&sweep_cooldown_secs),
            MintError::BadSweepBound);
        require!(sol_reserve_lamports == 0 || sol_reserve_lamports >= RENT_EXEMPT_0_BYTES, MintError::BadSweepBound);
        require_keys_neq!(swap_operator, Pubkey::default(), MintError::WrongTreasury);
        require_keys_neq!(payment_mint, Pubkey::default(), MintError::WrongPaymentMint);
        // THE CAPS MUST SUM TO SOMETHING THE SUPPLY CEILING ALLOWS, and none may be
        // zero-by-accident (a zero cap silently deletes a tier from the schedule).
        let cap_total: u64 = level_caps.iter().map(|c| *c as u64).sum();
        require!(level_caps.iter().all(|c| *c > 0), MintError::BadLevelCaps);
        require!(cap_total > 0 && cap_total <= max_supply, MintError::BadLevelCaps);
        // THE CHARTER WINDOW, ONCE. There is no setter and governance has no
        // action that reaches it, so "can never be re-activated" is these two
        // numbers and a clock. A window already over at init, or an all-zero root
        // (the not-set sentinel), is a launch mistake and is refused here.
        require!(charter_closes_at > charter_opens_at, MintError::BadCharterWindow);
        require!(charter_closes_at.checked_sub(charter_opens_at).ok_or(MintError::BadCharterWindow)? <= MAX_CHARTER_SECS,
            MintError::BadCharterWindow);
        require!(charter_closes_at > Clock::get()?.unix_timestamp, MintError::BadCharterWindow);
        require!(pob_root != [0u8; 32], MintError::BadPobRoot);
        require!((MIN_MONTHLY_SECS..=MONTHLY_SECS).contains(&monthly_secs), MintError::BadMonthlyPeriod);
        require_keys_neq!(pob_collection, Pubkey::default(), MintError::BadPobRoot);

        // ── the collection: clean, ours, unminted ──
        let (mint_pda, mint_bump) = Pubkey::find_program_address(&[MINT_SEED], &crate::ID);
        {
            let col = &ctx.accounts.collection;
            require_keys_eq!(*col.owner, MPL_CORE_ID, MintError::WrongCollection);
            let d = col.try_borrow_data()?;
            require!(d.len() >= 1 + 32 + 4 && d[0] == KEY_COLLECTION_V1, MintError::WrongCollection);
            let mut ua = [0u8; 32]; ua.copy_from_slice(&d[1..33]);
            require_keys_eq!(Pubkey::new_from_array(ua), mint_pda, MintError::CollectionNotOurs);
            // CollectionV1 = key | update_authority | name | uri | num_minted u32 |
            // current_size u32, and NOTHING after it unless a plugin header exists.
            let mut o = 33usize;
            for _ in 0..2 {
                require!(d.len() >= o + 4, MintError::WrongCollection);
                let l = u32::from_le_bytes(d[o..o + 4].try_into().unwrap()) as usize;
                o = o.checked_add(4 + l).ok_or(MintError::Overflow)?;
            }
            require!(d.len() >= o + 8, MintError::WrongCollection);
            require!(d[o..o + 4] == [0, 0, 0, 0], MintError::CollectionNotClean);
            require!(d.len() == o + 8, MintError::CollectionNotClean);
        }

        // ── RT2-7: SEAL first, and it must agree. SEAL's config is the canonical
        // wiring every mint checks; a SEAL naming another collection would refuse
        // every mint for ever. And the pool can only pay what a vault can be
        // REDEEMED holding, so the payment mint must be one of SEAL's reserves. ──
        check_seal_wiring(&ctx.accounts.seal_config, &ctx.accounts.collection.key())?;
        require!(seal_reserves(&ctx.accounts.seal_config)?.contains(&payment_mint), MintError::PaymentMintNotAReserve);

        // THE POOL: the config PDA's own ATA for the payment mint. Derived, never
        // a parameter, so no initializer can point the 85% at a wallet.
        let pool_ata = Pubkey::find_program_address(
            &[ctx.accounts.config.key().as_ref(), SPL_TOKEN_ID.as_ref(), payment_mint.as_ref()], &ATA_PROGRAM_ID).0;
        let collection_key = ctx.accounts.collection.key();
        let c = &mut ctx.accounts.config;
        let (gov_pda, _) = Pubkey::find_program_address(&[GOV_SEED], &GOV_PROGRAM_ID);
        c.version = MINT_CONFIG_VERSION;
        c.collection = collection_key;
        c.governance = gov_pda;
        c.pool_ata = pool_ata;
        c.round_id = 0;
        c.opens_at = 0;
        c.closes_at = 0;
        c.price = 0;
        c.cap = 0;
        c.minted_this_round = 0;
        c.minted_total = 0;
        c.max_supply = max_supply;
        c.bank_treasury = bank_treasury;
        c.split_bps = DEFAULT_SPLIT_BPS;
        c.sales_stopped = false;
        c.sweep_stopped = false;
        c.guardian = guardian.unwrap_or_default();
        c.swap_operator = swap_operator;
        c.sol_reserve_lamports = sol_reserve_lamports;
        c.bump = ctx.bumps.config;
        c.max_sweep_lamports = max_sweep_lamports;
        c.sweep_cooldown_secs = sweep_cooldown_secs;
        c.last_sweep_at = 0;
        c.level_caps = level_caps;
        c.level_minted = [0; 5];
        c.revealed_total = 0;
        c.payment_mint = payment_mint;
        c.pob_collection = pob_collection;
        c.pob_root = pob_root;
        c.charter_opens_at = charter_opens_at;
        c.charter_closes_at = charter_closes_at;
        c.charter_claimed = 0;
        c.bare_burns_retired = 0;
        c.total_active_weight = 0;
        c.active_count = 0;
        c.acc_scaled = 0;
        c.owed_scaled = 0;
        // THE MONTHLY CLOCK STARTS WHEN THE CHARTER WINDOW CLOSES, not at
        // initialize (red-team 3 finding 5): an initialize run weeks before the
        // window could otherwise let the first free epoch tick land inside it, and
        // join only the first few funded charter vaults ahead of everyone else.
        c.last_distribute_at = Clock::get()?.unix_timestamp.max(charter_closes_at);
        c.sales_stopped_at = 0;
        c.sweep_stopped_at = 0;
        c.pending_swap_operator = Pubkey::default();
        c.pending_swap_operator_at = 0;
        c.monthly_secs = monthly_secs;
        c.pending_guardian = Pubkey::default();
        c.pending_guardian_set = false;
        c.pending_guardian_at = 0;
        c.notice_secs = notice_secs;
        c.sweep_floor_lamports = sweep_floor_lamports;
        c.cooldown_ceiling_secs = cooldown_ceiling_secs;
        c.reserve_ceiling_lamports = reserve_ceiling_lamports;
        c.dist_epoch = 0;
        c.pending_count = 0;
        c.pending_this_epoch = 0;
        c.cbob_mint = ctx.accounts.cbob_mint.key();
        c.max_boost_weight = max_boost_weight;
        c.max_boost_epochs = max_boost_epochs;
        // OFF until a Governor vote sets the terms.
        c.boost_price = 0;
        c.boost_weight = 0;
        c.boost_epochs = 0;
        c.boosts_active = 0;
        c.boosts_due = 0;
        c.boost_weight_total = 0;
        c.cbob_burned_total = 0;
        c.boost_expiring = [0; BOOST_RING];
        emit_wiring(c);

        // ── the royalty, once and forever ──
        let (revenue, _) = Pubkey::find_program_address(&[REVENUE_SEED], &crate::ID);
        let mut data = vec![IX_ADD_COLLECTION_PLUGIN_V1, PLUGIN_ROYALTIES];
        data.extend_from_slice(&ROYALTY_BPS.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());               // one creator
        data.extend_from_slice(revenue.as_ref()); data.push(100);  // the revenue PDA, 100%
        data.push(RULESET_NONE);
        data.push(1); data.push(PLUGIN_AUTHORITY_NONE);            // Some(PluginAuthority::None)
        invoke_signed(&Instruction {
            program_id: MPL_CORE_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.collection.key(), false),
                AccountMeta::new(ctx.accounts.authority.key(), true),
                AccountMeta::new_readonly(mint_pda, true),
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                AccountMeta::new_readonly(MPL_CORE_ID, false),
            ],
            data,
        }, &[
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.mint_authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.mpl_core.to_account_info(),
        ], &[&[MINT_SEED, &[mint_bump]]])?;
        emit!(RoyaltiesFixed { basis_points: ROYALTY_BPS, revenue });
        Ok(())
    }

    /// GOVERNANCE ONLY, and it can only make the one trusted hop SMALLER.
    ///
    /// Stage 3b (Gary 2026-10-03, red-team 1 finding 1). v6 stage 1 turned every
    /// former admin power into a vote, and red-team 1 showed what that meant during
    /// the charter window: the first vault, voting alone, could point the 15% at
    /// itself, change the 85/15 split, lower `max_supply` for ever, and loosen the
    /// sweep. So `update_wiring` is GONE. The split, both destinations and
    /// `max_supply` are written once by `initialize` and nothing writes them again.
    /// What is left for a vote on the sweep is one direction only:
    ///   * `sol_reserve_lamports` may only go UP,
    ///   * `max_sweep_lamports` may only go DOWN,
    ///   * `sweep_cooldown_secs` may only go UP.
    ///
    /// APPLIED AS "AT LEAST THIS TIGHT", NEVER REFUSED FOR BEING LOOSER. GOV refuses
    /// a loosening request when the proposal is CREATED (against the values live
    /// then). By the time it executes, another passed tightening may have gone
    /// further; refusing here would revert every other action bundled with it, so
    /// each field takes the more restrictive of what is live and what was voted.
    /// The result is the same in any execution order, and it can never loosen.
    ///
    /// AND NEVER PAST THE BOUNDS `initialize` FIXED (stage 3c, red-team 2 finding
    /// 3): the reserve at most `reserve_ceiling_lamports`, the cap at least
    /// `sweep_floor_lamports`, the cooldown at most `cooldown_ceiling_secs`. GOV
    /// refuses an out-of-bounds proposal at creation against the same fixed
    /// values, so a ratified one never reaches this refusal.
    pub fn tighten_sweep(ctx: Context<Governed>, args: SweepTighten) -> Result<()> {
        let c = &mut ctx.accounts.config;
        let SweepTighten { sol_reserve_lamports, max_sweep_lamports, sweep_cooldown_secs } = args;
        require!(sol_reserve_lamports.is_some() || max_sweep_lamports.is_some() || sweep_cooldown_secs.is_some(),
            MintError::NothingToDo);
        if let Some(x) = sol_reserve_lamports {
            require!(x >= RENT_EXEMPT_0_BYTES && x <= c.reserve_ceiling_lamports, MintError::TightenOutOfBounds);
            c.sol_reserve_lamports = c.sol_reserve_lamports.max(x);
        }
        if let Some(x) = max_sweep_lamports {
            require!(x >= c.sweep_floor_lamports && x <= MAX_SWEEP_LAMPORTS, MintError::TightenOutOfBounds);
            c.max_sweep_lamports = c.max_sweep_lamports.min(x);
        }
        if let Some(x) = sweep_cooldown_secs {
            require!(x >= MIN_SWEEP_COOLDOWN_SECS && x <= c.cooldown_ceiling_secs, MintError::TightenOutOfBounds);
            c.sweep_cooldown_secs = c.sweep_cooldown_secs.max(x);
        }
        emit!(SweepTightened { sol_reserve_lamports: c.sol_reserve_lamports,
            max_sweep_lamports: c.max_sweep_lamports, sweep_cooldown_secs: c.sweep_cooldown_secs });
        Ok(())
    }

    /// GOVERNANCE ONLY. Arm a replacement swap operator. It does NOT take effect:
    /// `apply_swap_operator` lands it after `notice_secs`, so a vote that hands
    /// the hop to a hostile key is public for a week first, the guardian can stop
    /// the sweep for that week, and (stage 3c) the guardian can CANCEL it outright.
    /// Re-arming replaces the pending key and restarts the clock.
    /// GOVERNANCE ONLY: the $CBOB boost's terms (see `BOOST_RING`). A price of 0
    /// switches boosts off; otherwise the extra weight and the number of
    /// distributions must sit inside the bounds fixed at `initialize`, which GOV
    /// also checks when the proposal is created. Boosts already bought keep the
    /// terms they were bought under.
    pub fn set_boost_terms(ctx: Context<Governed>, price: u64, weight: u8, epochs: u16) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if price > 0 {
            require!(weight >= 1 && weight <= c.max_boost_weight, MintError::BoostTermsOutOfBounds);
            require!(epochs >= 1 && epochs <= c.max_boost_epochs, MintError::BoostTermsOutOfBounds);
        }
        c.boost_price = price;
        c.boost_weight = if price > 0 { weight } else { 0 };
        c.boost_epochs = if price > 0 { epochs } else { 0 };
        emit!(BoostTermsSet { price, weight: c.boost_weight, epochs: c.boost_epochs });
        Ok(())
    }

    pub fn arm_swap_operator(ctx: Context<Governed>, operator: Pubkey) -> Result<()> {
        require_keys_neq!(operator, Pubkey::default(), MintError::WrongTreasury);
        let c = &mut ctx.accounts.config;
        c.pending_swap_operator = operator;
        c.pending_swap_operator_at = Clock::get()?.unix_timestamp;
        let applies_after = c.pending_swap_operator_at.checked_add(c.notice_secs).ok_or(MintError::Overflow)?;
        msg!("CBOB_SWAP_OPERATOR_ARMED operator={} applies_after={}", operator, applies_after);
        emit!(SwapOperatorArmed { operator, applies_after });
        Ok(())
    }

    /// PERMISSIONLESS, once the notice has run. The pending key becomes the swap
    /// operator and the slot is cleared.
    pub fn apply_swap_operator(ctx: Context<ApplySwapOperator>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_keys_neq!(c.pending_swap_operator, Pubkey::default(), MintError::NoPendingOperator);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= c.pending_swap_operator_at.checked_add(c.notice_secs)
            .ok_or(MintError::Overflow)?, MintError::OperatorNoticeNotElapsed);
        c.swap_operator = c.pending_swap_operator;
        c.pending_swap_operator = Pubkey::default();
        c.pending_swap_operator_at = 0;
        emit_wiring(c);
        Ok(())
    }

    /// GUARDIAN ONLY. Cancel a PENDING swap operator before it lands (stage 3c,
    /// Gary 2026-10-03, red-team 2 finding 2). This is a stop, so it is the
    /// guardian's to make: it cannot install anyone, touch the operator in office,
    /// or move a lamport. A vote can re-arm, and the notice starts again.
    pub fn cancel_swap_operator(ctx: Context<Guardian>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_guardian(c, &ctx.accounts.guardian)?;
        require_keys_neq!(c.pending_swap_operator, Pubkey::default(), MintError::NoPendingOperator);
        let cancelled = c.pending_swap_operator;
        c.pending_swap_operator = Pubkey::default();
        c.pending_swap_operator_at = 0;
        msg!("CBOB_SWAP_OPERATOR_CANCELLED operator={}", cancelled);
        emit!(SwapOperatorCancelled { operator: cancelled });
        Ok(())
    }

    /// THE EMERGENCY BRAKE ON SALES. Guardian only, immediate, ONE-WAY.
    ///
    /// Gary, 2026-10-03: *"my wallet keep the privileges to stop a sell in an
    /// emergency but that's all. It can't turn back on without a vote. But it CAN
    /// stop if there's an emergency."* So there is no argument: this can only set
    /// the flag. Clearing it is `restart`, which is governance only.
    ///
    /// ⚠️ IT GATES `mint_vault` ONLY. `claim_charter_vault` does NOT read it: the
    /// charter window is fixed at `initialize` and can never reopen, so a stop
    /// there would cost a charter member their claim for good (Gary, 2026-10-03).
    pub fn emergency_stop_sales(ctx: Context<Guardian>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_guardian(c, &ctx.accounts.guardian)?;
        // The time is recorded on the TRANSITION only. A re-stop while already
        // stopped must not move it: `restart` refuses a restart voted BEFORE the
        // stop, and a hostile guardian re-stopping to keep the timestamp ahead of
        // every restart proposal would hold sales shut for ever.
        if !c.sales_stopped { c.sales_stopped_at = Clock::get()?.unix_timestamp; }
        c.sales_stopped = true;
        emit!(StopChanged { sales_stopped: c.sales_stopped, sweep_stopped: c.sweep_stopped, by_guardian: true });
        Ok(())
    }

    /// THE EMERGENCY BRAKE ON THE ONE TRUSTED HOP. Guardian only, immediate,
    /// ONE-WAY. It stops `sweep_sol_for_swap` and nothing else.
    pub fn emergency_stop_sweep(ctx: Context<Guardian>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_guardian(c, &ctx.accounts.guardian)?;
        if !c.sweep_stopped { c.sweep_stopped_at = Clock::get()?.unix_timestamp; }
        c.sweep_stopped = true;
        emit!(StopChanged { sales_stopped: c.sales_stopped, sweep_stopped: c.sweep_stopped, by_guardian: true });
        Ok(())
    }

    /// GOVERNANCE ONLY. Lift either stop.
    ///
    /// `proposal_created_at` is when the ratified proposal was CREATED. A restart
    /// voted before the stop it would lift is refused (`StopIsNewer`): a passed
    /// proposal stays executable for a week, and without this a restart ratified
    /// for one emergency could be executed by anyone to reopen sales in the middle
    /// of the NEXT one, which the guardian stopped after that vote opened.
    pub fn restart(ctx: Context<Governed>, sales: bool, sweep: bool, proposal_created_at: i64) -> Result<()> {
        require!(sales || sweep, MintError::NothingToDo);
        let c = &mut ctx.accounts.config;
        // STRICTLY older (round 22): a proposal created in the SAME second as the
        // stop was not voted knowing about it, so the stop wins the tie.
        if sales && c.sales_stopped {
            require!(c.sales_stopped_at < proposal_created_at, MintError::StopIsNewer);
        }
        if sweep && c.sweep_stopped {
            require!(c.sweep_stopped_at < proposal_created_at, MintError::StopIsNewer);
        }
        if sales { c.sales_stopped = false; }
        if sweep { c.sweep_stopped = false; }
        emit!(StopChanged { sales_stopped: c.sales_stopped, sweep_stopped: c.sweep_stopped, by_guardian: false });
        Ok(())
    }

    /// GOVERNANCE ONLY. ARM a replacement guardian, or the brake's retirement
    /// (`None`). It does NOT take effect: `apply_guardian` lands it after
    /// `notice_secs` (stage 3c, Gary 2026-10-03, red-team 2 finding 2). Until
    /// then the guardian in office keeps its brake, so a captured vote cannot
    /// remove the brake in the same breath as it does anything else. GOV also
    /// demands YES from half of ALL live vaults for it. The guardian has no power
    /// over its own replacement: cancelling one would be keeping office.
    pub fn arm_guardian(ctx: Context<Governed>, guardian: Option<Pubkey>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.pending_guardian = guardian.unwrap_or_default();
        c.pending_guardian_set = true;
        c.pending_guardian_at = Clock::get()?.unix_timestamp;
        let applies_after = c.pending_guardian_at.checked_add(c.notice_secs).ok_or(MintError::Overflow)?;
        msg!("CBOB_GUARDIAN_ARMED guardian={} applies_after={}", c.pending_guardian, applies_after);
        emit!(GuardianArmed { guardian, applies_after });
        Ok(())
    }

    /// PERMISSIONLESS, once the notice has run. The pending guardian (or `None`)
    /// takes office and the slot is cleared.
    pub fn apply_guardian(ctx: Context<ApplySwapOperator>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require!(c.pending_guardian_set, MintError::NoPendingGuardian);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= c.pending_guardian_at.checked_add(c.notice_secs).ok_or(MintError::Overflow)?,
            MintError::GuardianNoticeNotElapsed);
        c.guardian = c.pending_guardian;
        c.pending_guardian = Pubkey::default();
        c.pending_guardian_set = false;
        c.pending_guardian_at = 0;
        emit_wiring(c);
        Ok(())
    }

    /// THE RATIFIED VOTE LANDS HERE. When, how much, how many.
    ///
    /// v6 stage 2: the price is in the PAYMENT MINT's base units (satoshis of
    /// cbBTC) and may not be below `MIN_ROUND_PRICE_SATS`. A voted round is never
    /// free and never accepts a Proof of Burn: the free path is the charter
    /// window, and it closes forever.
    pub fn set_round(
        ctx: Context<Governed>,
        opens_at: i64,
        closes_at: i64,
        price: u64,
        cap: u32,
    ) -> Result<()> {
        require!(closes_at > opens_at, MintError::BadWindow);
        require!(closes_at.checked_sub(opens_at).ok_or(MintError::BadWindow)? <= MAX_ROUND_SECS,
            MintError::BadWindow);
        // `cap == 0` used to mean UNLIMITED. There is no unlimited sentinel.
        require!(cap > 0, MintError::BadCap);
        require!(price >= MIN_ROUND_PRICE_SATS, MintError::PriceBelowFloor);
        let c = &mut ctx.accounts.config;
        c.round_id = c.round_id.checked_add(1).ok_or(MintError::Overflow)?;
        c.opens_at = opens_at;
        c.closes_at = closes_at;
        c.price = price;
        c.cap = cap;
        c.minted_this_round = 0;
        emit!(RoundSet { round_id: c.round_id, opens_at, closes_at, price, cap });
        Ok(())
    }

    /// THE 85/15, ENFORCED. Permissionless: the destinations and the ratio are
    /// pinned in config, so there is nothing to choose. The Squads' share is
    /// floored and the holders take the remainder.
    ///
    /// v6 stage 3: the holders' side is THE POOL, and only the payment mint
    /// (cbBTC) splits, because the pool can only pay vaults in cbBTC. v5 split any
    /// token to a wallet that could swap it; a non-cbBTC holders' share sent to
    /// the pool would sit there with no path out. Any other token sent to the
    /// revenue address stays there (accepted limit, SPEC).
    pub fn split_revenue(ctx: Context<SplitRevenue>, decimals: u8) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let (revenue, rev_bump) = Pubkey::find_program_address(&[REVENUE_SEED], &crate::ID);
        require_keys_eq!(ctx.accounts.revenue.key(), revenue, MintError::WrongTreasury);
        require_keys_eq!(ctx.accounts.mint.key(), cfg.payment_mint, MintError::WrongPaymentMint);

        let expect = |wallet: &Pubkey| Pubkey::find_program_address(
            &[wallet.as_ref(), SPL_TOKEN_ID.as_ref(), ctx.accounts.mint.key().as_ref()], &ATA_PROGRAM_ID).0;
        require_keys_eq!(ctx.accounts.revenue_ata.key(), expect(&revenue), MintError::WrongTreasury);
        require_keys_eq!(ctx.accounts.holders_ata.key(), cfg.pool_ata, MintError::WrongTreasury);
        require_keys_eq!(ctx.accounts.bank_ata.key(), expect(&cfg.bank_treasury), MintError::WrongTreasury);

        let total = {
            let d = ctx.accounts.revenue_ata.try_borrow_data()?;
            require!(d.len() >= 72, MintError::WrongTreasury);
            let mut a = [0u8; 8]; a.copy_from_slice(&d[64..72]);
            u64::from_le_bytes(a)
        };
        require!(total > 0, MintError::NothingToSplit);
        let bank_cut = ((total as u128) * ((BPS as u128) - (cfg.split_bps as u128)) / BPS as u128) as u64;
        let holders = total.checked_sub(bank_cut).ok_or(MintError::Overflow)?;

        for (amount, dest) in [(holders, &ctx.accounts.holders_ata), (bank_cut, &ctx.accounts.bank_ata)] {
            if amount == 0 { continue }
            let mut data = vec![IX_TRANSFER_CHECKED];
            data.extend_from_slice(&amount.to_le_bytes());
            data.push(decimals);
            invoke_signed(&Instruction {
                program_id: SPL_TOKEN_ID,
                accounts: vec![
                    AccountMeta::new(ctx.accounts.revenue_ata.key(), false),
                    AccountMeta::new_readonly(ctx.accounts.mint.key(), false),
                    AccountMeta::new(dest.key(), false),
                    AccountMeta::new_readonly(revenue, true),
                ],
                data,
            }, &[
                ctx.accounts.revenue_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                dest.to_account_info(),
                ctx.accounts.revenue.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ], &[&[REVENUE_SEED, &[rev_bump]]])?;
        }
        emit!(RevenueSplit { mint: ctx.accounts.mint.key(), total, holders, bank: bank_cut, split_bps: cfg.split_bps });
        Ok(())
    }

    /// Move SOL out of the revenue address to the pinned swap operator, which
    /// converts it to cbBTC off-chain and deposits the result BACK here. Since
    /// stage 2 mint prices arrive as cbBTC already, so this hop carries only
    /// secondary royalties (which marketplaces pay in SOL).
    ///
    /// THE ONE TRUSTED HOP: destination PINNED, cap AND cooldown on chain, the
    /// operator SIGNS (an unsigned sweep under a cooldown is a grief handle), and
    /// the guardian can stop it.
    pub fn sweep_sol_for_swap(ctx: Context<SweepSolForSwap>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cfg = &ctx.accounts.config;
        require!(!cfg.sweep_stopped, MintError::SweepStopped);
        require!(amount > 0, MintError::SweepAboveCap);
        require_keys_eq!(ctx.accounts.swap_operator.key(), cfg.swap_operator, MintError::WrongTreasury);
        require!(amount <= cfg.max_sweep_lamports, MintError::SweepAboveCap);
        require!(now >= cfg.last_sweep_at.checked_add(cfg.sweep_cooldown_secs).ok_or(MintError::Overflow)?,
            MintError::SweepTooSoon);
        let (revenue, rev_bump) = Pubkey::find_program_address(&[REVENUE_SEED], &crate::ID);
        require_keys_eq!(ctx.accounts.revenue.key(), revenue, MintError::WrongTreasury);
        let bal = ctx.accounts.revenue.lamports();
        let keep = cfg.sol_reserve_lamports;
        require!(bal >= keep.checked_add(amount).ok_or(MintError::Overflow)?, MintError::ReserveWouldBreach);
        let operator = cfg.swap_operator;
        invoke_signed(
            &system_instruction::transfer(&revenue, &ctx.accounts.swap_operator.key(), amount),
            &[ctx.accounts.revenue.to_account_info(), ctx.accounts.swap_operator.to_account_info()],
            &[&[REVENUE_SEED, &[rev_bump]]])?;
        let c = &mut ctx.accounts.config;
        c.last_sweep_at = now;
        emit!(SolSweptForSwap { amount, operator, remaining: bal - amount });
        Ok(())
    }

    /// Mint a vault in a VOTED round. The owner signs, the payer pays the round
    /// price in cbBTC (the payment mint) into the revenue address, and the level
    /// is NOT chosen here by anyone: it is drawn after the fact (`reveal_level`).
    ///
    /// `max_price` is the payer's slippage guard: a ratified `set_round` can
    /// reprice between a buyer simulating and their transaction landing.
    pub fn mint_vault(ctx: Context<MintVault>, name: String, uri: String, max_price: u64,
                      attributes: Vec<VaultAttribute>) -> Result<()> {
        { let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
          monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)?; }
        let cfg = &ctx.accounts.config;
        // THE GUARDIAN'S FIRST BRAKE. Only governance can lift it (`restart`).
        require!(!cfg.sales_stopped, MintError::SalesStopped);
        let now = Clock::get()?.unix_timestamp;
        require!(cfg.round_id > 0, MintError::NoRound);
        require!(now >= cfg.opens_at && now < cfg.closes_at, MintError::RoundClosed);
        require!(cfg.minted_this_round < cfg.cap, MintError::RoundCapReached);
        require!(cfg.price <= max_price, MintError::PriceAboveMax);
        check_supply(cfg)?;
        check_attributes(&attributes, MAX_ATTRS - 1)?;

        // ── the price, in cbBTC, into THE revenue address ──
        {
            require_keys_eq!(ctx.accounts.payment_mint.key(), cfg.payment_mint, MintError::WrongPaymentMint);
            require_keys_eq!(*ctx.accounts.payment_mint.owner, SPL_TOKEN_ID, MintError::WrongPaymentMint);
            let decimals = {
                let d = ctx.accounts.payment_mint.try_borrow_data()?;
                require!(d.len() == SPL_MINT_LEN, MintError::WrongPaymentMint);
                d[SPL_MINT_DECIMALS_OFF]
            };
            let (revenue, _) = Pubkey::find_program_address(&[REVENUE_SEED], &crate::ID);
            let (rev_ata, _) = Pubkey::find_program_address(
                &[revenue.as_ref(), SPL_TOKEN_ID.as_ref(), cfg.payment_mint.as_ref()], &ATA_PROGRAM_ID);
            require_keys_eq!(ctx.accounts.revenue_token.key(), rev_ata, MintError::WrongTreasury);
            let mut data = vec![IX_TRANSFER_CHECKED];
            data.extend_from_slice(&cfg.price.to_le_bytes());
            data.push(decimals);
            invoke(&Instruction {
                program_id: SPL_TOKEN_ID,
                accounts: vec![
                    AccountMeta::new(ctx.accounts.payer_token.key(), false),
                    AccountMeta::new_readonly(ctx.accounts.payment_mint.key(), false),
                    AccountMeta::new(ctx.accounts.revenue_token.key(), false),
                    AccountMeta::new_readonly(ctx.accounts.payer.key(), true),
                ],
                data,
            }, &[
                ctx.accounts.payer_token.to_account_info(),
                ctx.accounts.payment_mint.to_account_info(),
                ctx.accounts.revenue_token.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ])?;
        }

        check_seal_wiring(&ctx.accounts.seal_config, &cfg.collection)?;
        require_keys_eq!(ctx.accounts.collection.key(), cfg.collection, MintError::WrongCollection);
        create_vault(&ctx.accounts.asset, &ctx.accounts.collection, &ctx.accounts.mint_authority,
            &ctx.accounts.payer, &ctx.accounts.owner, &ctx.accounts.mpl_core, &ctx.accounts.system_program,
            ctx.bumps.mint_authority, &name, &uri, &attributes)?;

        let slot = Clock::get()?.slot;
        let c = &mut ctx.accounts.config;
        let index = c.minted_total;
        c.minted_this_round = c.minted_this_round.checked_add(1).ok_or(MintError::Overflow)?;
        c.minted_total = c.minted_total.checked_add(1).ok_or(MintError::Overflow)?;
        write_record(&mut ctx.accounts.vault_record, ctx.accounts.asset.key(), index, slot,
            false, &attributes, ctx.bumps.vault_record)?;
        emit!(VaultMinted { asset: ctx.accounts.asset.key(), owner: ctx.accounts.owner.key(),
            round_id: c.round_id, price: c.price, mint_index: index, charter: false });
        // Remaining accounts: [SlotHashes, queued records...], optional.
        crank(ctx.remaining_accounts, slot)?;
        Ok(())
    }

    /// THE CHARTER CLAIM. One Proof of Burn in, one vault out, free, and only
    /// inside the window `initialize` fixed. Gary, 2026-10-03: *"We open it on
    /// schedule for the burns to burn and claim their vault. That will close in x
    /// days and then that can never be re-activated again."*
    ///
    ///   * The OWNER signs, and must own the PoB: this program CPI-burns it as its
    ///     owner, in this instruction, so a vault can never exist without its PoB
    ///     being destroyed and a PoB can never be destroyed without its vault.
    ///   * The PoB must be a leaf of `pob_root` — identity by ADDRESS (see the PROOF
    ///     OF BURN SET block). A lookalike in the same collection is refused.
    ///   * Outside `[charter_opens_at, charter_closes_at)` it refuses by clock
    ///     alone. No flag, so nothing to flip.
    ///   * NOT gated by the guardian's sales stop, by ruling.
    ///   * Counts toward the lifetime supply and the level census like any mint;
    ///     the level is drawn later, the same way.
    ///   * `pob_extra` (stage 3c, red-team 2 finding 1): the FIRST `pob_extra`
    ///     remaining accounts are handed to Core's burn of the Proof of Burn, after
    ///     its fixed accounts. The Giraffish Moments collection's update authority
    ///     (a hot wallet, kept by Gary's ruling) can add an external plugin such as
    ///     an Oracle that Core consults on every burn; Core then refuses a burn
    ///     that does not carry the plugin's accounts, and with no way to supply
    ///     them every claim would fail until a window nobody can reopen closed.
    ///     They are passed never as signers, and Core decides what they mean: a
    ///     hook that APPROVES or PASSES lets the claim through, one that REJECTS
    ///     still refuses it (that case is the alarm's, by ruling). The rest of the
    ///     remaining accounts are the optional crank, as on every host.
    pub fn claim_charter_vault<'info>(ctx: Context<'_, '_, '_, 'info, ClaimCharterVault<'info>>, name: String, uri: String,
                               attributes: Vec<VaultAttribute>, pob_proof: Vec<[u8; 32]>, pob_extra: u8) -> Result<()> {
        let n_extra = pob_extra as usize;
        require!(n_extra <= MAX_POB_EXTRA && n_extra <= ctx.remaining_accounts.len(), MintError::BadPobExtra);
        let (extra, crank_accts) = ctx.remaining_accounts.split_at(n_extra);
        { let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
          monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)?; }
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        require!(now >= cfg.charter_opens_at, MintError::CharterNotOpen);
        require!(now < cfg.charter_closes_at, MintError::CharterClosed);
        check_supply(cfg)?;
        // The program appends `charter` and later `level`, so the caller gets two
        // fewer than the total.
        check_attributes(&attributes, MAX_ATTRS - 2)?;

        // ── the Proof of Burn: a live Core asset in the PoB collection, owned by
        // the signer, and a leaf of the committed set ──
        let pob = ctx.accounts.pob_asset.key();
        {
            let a = &ctx.accounts.pob_asset;
            require_keys_eq!(*a.owner, MPL_CORE_ID, MintError::NotAProofOfBurn);
            let d = a.try_borrow_data()?;
            require!(d.len() >= 66 && d[0] == KEY_ASSET_V1, MintError::NotAProofOfBurn);
            let mut o = [0u8; 32]; o.copy_from_slice(&d[1..33]);
            require_keys_eq!(Pubkey::new_from_array(o), ctx.accounts.owner.key(), MintError::NotThePobOwner);
            require!(d[33] == UA_DISC_COLLECTION, MintError::NotAProofOfBurn);
            let mut c = [0u8; 32]; c.copy_from_slice(&d[34..66]);
            require_keys_eq!(Pubkey::new_from_array(c), cfg.pob_collection, MintError::NotAProofOfBurn);
        }
        require_keys_eq!(ctx.accounts.pob_collection.key(), cfg.pob_collection, MintError::NotAProofOfBurn);
        require!(pob_proof.len() <= MAX_POB_PROOF, MintError::PobProofTooLong);
        require!(merkle_root_from(merkle_leaf(&pob), &pob_proof) == cfg.pob_root, MintError::NotInPobSet);

        // ── burn it, as its owner, with any external-plugin accounts passed through ──
        {
            let mut metas = vec![
                AccountMeta::new(pob, false),
                AccountMeta::new(ctx.accounts.pob_collection.key(), false),
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new_readonly(ctx.accounts.owner.key(), true),
                AccountMeta::new_readonly(MPL_CORE_ID, false),
                AccountMeta::new_readonly(MPL_CORE_ID, false),
            ];
            let mut infos = vec![
                ctx.accounts.pob_asset.to_account_info(),
                ctx.accounts.pob_collection.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.mpl_core.to_account_info(),
            ];
            for a in extra.iter() {
                // NEVER as a signer: a pass-through account must not carry any
                // authority into Core that the caller did not already hold.
                metas.push(if a.is_writable { AccountMeta::new(a.key(), false) } else { AccountMeta::new_readonly(a.key(), false) });
                infos.push(a.clone());
            }
            invoke(&Instruction { program_id: MPL_CORE_ID, accounts: metas, data: vec![IX_BURN_V1, 0] }, &infos)?;
        }

        let mut full = attributes.clone();
        full.push(VaultAttribute { key: ATTR_CHARTER.to_string(), value: pob.to_string() });
        check_seal_wiring(&ctx.accounts.seal_config, &cfg.collection)?;
        require_keys_eq!(ctx.accounts.collection.key(), cfg.collection, MintError::WrongCollection);
        create_vault(&ctx.accounts.asset, &ctx.accounts.collection, &ctx.accounts.mint_authority,
            &ctx.accounts.payer, &ctx.accounts.owner, &ctx.accounts.mpl_core, &ctx.accounts.system_program,
            ctx.bumps.mint_authority, &name, &uri, &full)?;

        let slot = Clock::get()?.slot;
        let c = &mut ctx.accounts.config;
        let index = c.minted_total;
        c.minted_total = c.minted_total.checked_add(1).ok_or(MintError::Overflow)?;
        c.charter_claimed = c.charter_claimed.checked_add(1).ok_or(MintError::Overflow)?;
        write_record(&mut ctx.accounts.vault_record, ctx.accounts.asset.key(), index, slot,
            true, &full, ctx.bumps.vault_record)?;
        emit!(CharterClaimed { asset: ctx.accounts.asset.key(), owner: ctx.accounts.owner.key(),
            proof_of_burn: pob, mint_index: index });
        crank(crank_accts, slot)?;
        Ok(())
    }

    /// Copy a vault's entropy out of SlotHashes before it ages out. Permissionless,
    /// any order, idempotent-refusing. The value does not depend on WHEN this is
    /// called (see `blockhash_in_window`), only WHETHER it is called in time.
    pub fn capture_entropy(ctx: Context<CaptureEntropy>) -> Result<()> {
        let now = Clock::get()?.slot;
        let r = &mut ctx.accounts.vault_record;
        require!(r.level == 0 && !r.entropy_set, MintError::AlreadyCaptured);
        let entropy = match try_capture(&ctx.accounts.slot_hashes.to_account_info(), r.reveal_slot, now, &r.asset)? {
            Capture::Got(e) => e,
            Capture::NotYet => return err!(MintError::RevealTooEarly),
            Capture::Expired => return err!(MintError::RevealWindowExpired),
        };
        r.entropy = entropy;
        r.entropy_set = true;
        Ok(())
    }

    /// A MISSED CAPTURE WINDOW IS RESCHEDULED, NEVER DEFAULTED. Permissionless.
    ///
    /// Allowed only once the window has PASSED (`now > reveal_slot + window`) and
    /// nothing was captured. The new target is `now + REVEAL_LEAD_SLOTS`: a slot
    /// that does not exist when this lands, so nobody chooses among hashes they
    /// can already see. The FIFO waits; nothing behind this vault is drawn first,
    /// so nobody behind it gets an outcome chosen for them.
    pub fn reschedule_reveal(ctx: Context<RescheduleReveal>) -> Result<()> {
        let now = Clock::get()?.slot;
        let r = &mut ctx.accounts.vault_record;
        require!(r.level == 0 && !r.entropy_set, MintError::AlreadyCaptured);
        require!(now > r.reveal_slot.checked_add(REVEAL_WINDOW_SLOTS).ok_or(MintError::Overflow)?,
            MintError::RescheduleTooEarly);
        reschedule(r, now)
    }

    /// Draw the level, IN MINT ORDER, and write it onto the vault. Permissionless.
    ///
    /// The caller re-supplies the vault's provenance attributes, because Core's
    /// `UpdatePluginV1` REPLACES the whole list (round 5) and parsing Core's plugin
    /// registry here would be a second, fragile copy of Core. They are checked
    /// against the hash the mint stored, so a caller cannot change a single byte.
    ///
    /// A vault already BURNED (a bare Core burn, or a redemption before its reveal)
    /// still takes its draw — otherwise the FIFO would stop forever at it and the
    /// census would drift — and the write to Core is skipped. Burned is identified
    /// POSITIVELY (round 21): Core-owned, one byte, `Key::Uninitialized`.
    pub fn reveal_level(ctx: Context<RevealLevel>, attributes: Vec<VaultAttribute>) -> Result<()> {
        let now = Clock::get()?.slot;
        let (asset, index, reveal_slot, set, stored, hash) = {
            let r = &ctx.accounts.vault_record;
            (r.asset, r.mint_index, r.reveal_slot, r.entropy_set, r.entropy, r.attrs_hash)
        };
        require!(ctx.accounts.vault_record.level == 0, MintError::AlreadyRevealed);
        require!(index == ctx.accounts.config.revealed_total, MintError::RevealOutOfOrder);
        require_keys_eq!(ctx.accounts.asset.key(), asset, MintError::WrongAsset);
        require_keys_eq!(ctx.accounts.collection.key(), ctx.accounts.config.collection, MintError::WrongCollection);

        // NO LEVEL WITHOUT REAL ENTROPY. Captured inline here if it is still in
        // the window, and STORED so every draw stays replayable; a missed window
        // must be rescheduled first (Gary: "We can't lock everyone in the lowest
        // level").
        let entropy: [u8; 32] = if set { stored } else {
            match try_capture(&ctx.accounts.slot_hashes.to_account_info(), reveal_slot, now, &asset)? {
                Capture::Got(e) => {
                    let r = &mut ctx.accounts.vault_record;
                    r.entropy = e; r.entropy_set = true;
                    e
                }
                Capture::NotYet => return err!(MintError::RevealTooEarly),
                Capture::Expired => return err!(MintError::NeedsReschedule),
            }
        };

        let c = &mut ctx.accounts.config;
        let remaining: Vec<u64> = (0..5).map(|i| (c.level_caps[i] as u64).saturating_sub(c.level_minted[i] as u64)).collect();
        let total: u64 = remaining.iter().sum();
        require!(total > 0, MintError::LevelCapReached);
        let li = {
            let mut x = u64::from_le_bytes(entropy[0..8].try_into().unwrap()) % total;
            let mut pick = 0usize;
            for (i, r) in remaining.iter().enumerate() {
                if x < *r { pick = i; break; }
                x -= *r;
            }
            pick
        };
        c.level_minted[li] = c.level_minted[li].checked_add(1).ok_or(MintError::Overflow)?;
        c.revealed_total = c.revealed_total.checked_add(1).ok_or(MintError::Overflow)?;
        let r = &mut ctx.accounts.vault_record;
        r.level = (li + 1) as u8;

        let burned = {
            let a = &ctx.accounts.asset;
            let d = a.try_borrow_data()?;
            *a.owner == MPL_CORE_ID && d.len() == 1 && d[0] == 0
        };
        if !burned {
            {
                let a = &ctx.accounts.asset;
                require_keys_eq!(*a.owner, MPL_CORE_ID, MintError::WrongAsset);
                let d = a.try_borrow_data()?;
                require!(!d.is_empty() && d[0] == KEY_ASSET_V1, MintError::WrongAsset);
            }
            require!(hashv(&[&attributes.try_to_vec()?]).to_bytes() == hash, MintError::AttributesMismatch);
            let mut data = vec![IX_UPDATE_PLUGIN_V1, PLUGIN_ATTRIBUTES];
            data.extend_from_slice(&((attributes.len() + 1) as u32).to_le_bytes());
            for a in attributes.iter() { push_attr(&mut data, &a.key, &a.value); }
            push_attr(&mut data, ATTR_LEVEL, LEVEL_NAMES[li]);
            invoke_signed(&Instruction {
                program_id: MPL_CORE_ID,
                accounts: vec![
                    AccountMeta::new(asset, false),
                    AccountMeta::new(ctx.accounts.collection.key(), false),
                    AccountMeta::new(ctx.accounts.payer.key(), true),
                    AccountMeta::new_readonly(ctx.accounts.mint_authority.key(), true),
                    AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                    AccountMeta::new_readonly(MPL_CORE_ID, false),
                ],
                data,
            }, &[
                ctx.accounts.asset.to_account_info(),
                ctx.accounts.collection.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.mint_authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.mpl_core.to_account_info(),
            ], &[&[MINT_SEED, &[ctx.bumps.mint_authority]]])?;
        }
        emit!(LevelRevealed { asset, mint_index: index, level: (li + 1) as u8, burned });
        Ok(())
    }

    // ═══════════════════════════ THE COMMUNITY POOL ═══════════════════════════

    /// Admit a vault to the payout schedule. Permissionless. TWO CALLS (stage 3c).
    ///
    /// THE FIRST CALL REQUESTS. It requires the level drawn, the asset LIVE in our
    /// collection, and its own canonical cbBTC account (classic SPL ATA of its
    /// asset-signer PDA) holding at least 21,000 sats. Contents cannot leave a
    /// sealed vault except by a redemption that burns it, so the balance only
    /// rises: activation is permanent for the vault's life, and funding for a
    /// moment buys nothing. The request records the distribution epoch it was
    /// made in.
    ///
    /// THE VAULT JOINS ONLY AFTER THE NEXT DISTRIBUTION (red-team 2 finding 5).
    /// Before stage 3c a vault joined at once with `debt = weight * acc`, so
    /// `activate` then `distribute` in ONE transaction handed it a full share of a
    /// backlog that built up before it existed, and at launch the first activator
    /// took all of it. Now the second call (or any `claim` that names the vault)
    /// JOINS it once `dist_epoch` has moved past the request: it was excluded from
    /// that distribution, enters at the accumulator as it then stands, and earns
    /// from the one after. Our crank joins every waiting vault right after each
    /// distribution, in the claims it already sends.
    pub fn activate(ctx: Context<Activate>) -> Result<()> {
        crank(ctx.remaining_accounts, Clock::get()?.slot)?;
        // BEFORE the activation: a month's revenue belongs to the vaults that were
        // active during it, not to one admitted in the instruction that closes it.
        { let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
          monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)?; }
        let payment_mint = ctx.accounts.config.payment_mint;
        let collection = ctx.accounts.config.collection;
        let r = &ctx.accounts.vault_record;
        require!(!r.retired, MintError::VaultRetired);
        require!(!r.active, MintError::AlreadyActive);
        if r.pending {
            // THE SECOND CALL: join, if a distribution has run since the request.
            require_keys_eq!(ctx.accounts.asset.key(), r.asset, MintError::WrongAsset);
            require_live_vault(&ctx.accounts.asset, &collection)?;
            require!(ctx.accounts.config.dist_epoch > r.request_epoch, MintError::ActivationPending);
            let (c, r) = (&mut ctx.accounts.config, &mut ctx.accounts.vault_record);
            return join(c, r);
        }
        require!((1..=5).contains(&r.level), MintError::NotRevealed);
        require_keys_eq!(ctx.accounts.asset.key(), r.asset, MintError::WrongAsset);
        require_live_vault(&ctx.accounts.asset, &collection)?;
        let (signer, _) = Pubkey::find_program_address(&[EXECUTE_PREFIX, r.asset.as_ref()], &MPL_CORE_ID);
        let (want, _) = Pubkey::find_program_address(
            &[signer.as_ref(), SPL_TOKEN_ID.as_ref(), payment_mint.as_ref()], &ATA_PROGRAM_ID);
        require_keys_eq!(ctx.accounts.vault_token.key(), want, MintError::WrongVaultAccount);
        let (amount, _) = read_token(&ctx.accounts.vault_token, &payment_mint, &signer)?;
        require!(amount >= ACTIVATION_SATS, MintError::BelowActivation);

        let c = &mut ctx.accounts.config;
        c.pending_count = c.pending_count.checked_add(1).ok_or(MintError::Overflow)?;
        c.pending_this_epoch = c.pending_this_epoch.checked_add(1).ok_or(MintError::Overflow)?;
        let epoch = c.dist_epoch;
        let r = &mut ctx.accounts.vault_record;
        r.pending = true;
        r.request_epoch = epoch;
        r.vault_ata = want;
        msg!("CBOB_ACTIVATION_REQUESTED asset={} epoch={}", r.asset, epoch);
        emit!(ActivationRequested { asset: r.asset, level: r.level, balance: amount, request_epoch: epoch });
        Ok(())
    }

    /// BURN $CBOB TO BOOST A VAULT (see `BOOST_RING` for the whole rule).
    ///
    /// ONLY THE VAULT'S OWNER may boost it (Gary 2026-10-04: "no gifted boosts";
    /// round 23 showed a gift occupies the one boost slot for N distributions,
    /// taking the owner's own timing away from them). The owner's own
    /// `boost_price` $CBOB is destroyed with an SPL Burn of THE pinned mint, and
    /// the vault weighs `boost_weight` more for the next `boost_epochs`
    /// distributions. Refused while boosts are off (price 0), while the vault is
    /// not activated or already carries a boost, for a burned vault, and for any
    /// signer who is not the asset's current owner.
    ///
    /// The monthly in-line run goes FIRST, like every host: a month already due
    /// belongs to the weights that earned it, not to a boost bought in the
    /// instruction that closes it.
    ///
    /// THE BUYER'S TERMS (round 23, F11): the price, weight and length the owner
    /// saw when signing. A ratified vote landing between signing and execution
    /// would otherwise burn the NEW price for the NEW terms; instead it refuses
    /// (`BoostTermsMoved`) before anything is burned, like `mint_vault`'s `max_price`.
    pub fn boost_vault(ctx: Context<BoostVault>, max_price: u64, min_weight: u8, min_epochs: u16) -> Result<()> {
        { let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
          let pool = ctx.accounts.pool_token.to_account_info();
          monthly_inline(&mut ctx.accounts.config, &pool, &k, now)?; }
        let (price, extra, epochs, cbob, collection) = {
            let c = &ctx.accounts.config;
            (c.boost_price, c.boost_weight, c.boost_epochs, c.cbob_mint, c.collection)
        };
        require!(price > 0 && extra > 0 && epochs > 0, MintError::BoostsOff);
        require!(price <= max_price && extra >= min_weight && epochs >= min_epochs, MintError::BoostTermsMoved);
        {
            let r = &ctx.accounts.vault_record;
            require!(r.active && !r.retired && !r.pending, MintError::BoostNeedsActiveVault);
            require!(r.boost_weight == 0, MintError::BoostActive);
            require_keys_eq!(ctx.accounts.asset.key(), r.asset, MintError::WrongAsset);
        }
        require_live_vault(&ctx.accounts.asset, &collection)?;
        {
            // The asset's CURRENT owner (Core AssetV1: key, then owner), read at
            // execution, so a vault sold a second ago is boosted by its new owner.
            let d = ctx.accounts.asset.try_borrow_data()?;
            let mut o = [0u8; 32]; o.copy_from_slice(&d[1..33]);
            require_keys_eq!(Pubkey::new_from_array(o), ctx.accounts.burner.key(), MintError::BoostNotTheOwner);
        }
        // THE mint, by address, and CLASSIC SPL by owner, before any CPI.
        require_keys_eq!(ctx.accounts.cbob_mint.key(), cbob, MintError::WrongCbobMint);
        require_keys_eq!(*ctx.accounts.cbob_mint.owner, SPL_TOKEN_ID, MintError::WrongCbobMint);
        let burner = ctx.accounts.burner.key();
        let (bal, state) = read_token(&ctx.accounts.burner_token, &cbob, &burner)?;
        require!(state == TOKEN_STATE_INITIALIZED && bal >= price, MintError::InsufficientCbob);
        let mut data = vec![IX_SPL_BURN];
        data.extend_from_slice(&price.to_le_bytes());
        invoke(&Instruction {
            program_id: SPL_TOKEN_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.burner_token.key(), false),
                AccountMeta::new(cbob, false),
                AccountMeta::new_readonly(burner, true),
            ],
            data,
        }, &[ctx.accounts.burner_token.to_account_info(), ctx.accounts.cbob_mint.to_account_info(),
             ctx.accounts.burner.to_account_info(), ctx.accounts.token_program.to_account_info()])?;

        let c = &mut ctx.accounts.config;
        let r = &mut ctx.accounts.vault_record;
        let end = c.dist_epoch.checked_add(epochs as u64).ok_or(MintError::Overflow)?;
        let i = (end % BOOST_RING as u64) as usize;
        c.boost_expiring[i] = c.boost_expiring[i].checked_add(1).ok_or(MintError::Overflow)?;
        c.boosts_active = c.boosts_active.checked_add(1).ok_or(MintError::Overflow)?;
        c.boost_weight_total = c.boost_weight_total.checked_add(extra as u64).ok_or(MintError::Overflow)?;
        c.cbob_burned_total = c.cbob_burned_total.checked_add(price).ok_or(MintError::Overflow)?;
        reweigh(c, r, extra)?;
        r.boost_end_epoch = end;
        msg!("CBOB_BOOSTED asset={} burned={} weight={} end_epoch={}", r.asset, price, extra, end);
        emit!(Boosted { asset: r.asset, burner, burned: price, extra_weight: extra, end_epoch: end,
            total_weight: c.total_active_weight });
        Ok(())
    }

    /// EXPIRE DUE BOOSTS, needing nothing but their records. Permissionless.
    ///
    /// Remaining accounts: vault records (writable). Each whose boost is DUE is
    /// expired exactly as `claim` would; anything else (no boost, not due yet,
    /// retired) is skipped, so a batch that races another expirer still lands.
    /// This is what keeps the `BoostsExpireFirst` gate from ever depending on a
    /// vault's token account: `claim` expires too, but a claim that owes a sat
    /// needs the vault's recorded cbBTC account to exist, and this does not.
    pub fn expire_boosts<'info>(ctx: Context<'_, '_, '_, 'info, ExpireBoosts<'info>>) -> Result<()> {
        let rem = ctx.remaining_accounts;
        require!(!rem.is_empty() && rem.len() <= MAX_EXPIRE_BATCH, MintError::BadClaimList);
        let mut n = 0u32;
        for ri in rem.iter() {
            require!(ri.is_writable, MintError::BadVaultRecord);
            let mut r = load_record(ri)?;
            if r.retired || !r.active || r.boost_weight == 0 || ctx.accounts.config.dist_epoch < r.boost_end_epoch {
                continue;
            }
            expire_boost(&mut ctx.accounts.config, &mut r)?;
            store_record(ri, &r)?;
            n += 1;
        }
        msg!("CBOB_BOOSTS_EXPIRED n={} due_left={}", n, ctx.accounts.config.boosts_due);
        Ok(())
    }

    /// Move the pool's undistributed cbBTC into the accumulator. Permissionless.
    ///
    /// Undistributed = pool balance minus what is already owed (rounded UP, so a
    /// sub-sat residue owed to a vault is never handed out twice). Dust stays in
    /// the pool and carries; nobody keeps a cut.
    ///
    /// THE TRIGGER (Gary, 2026-10-03): `burn = true` and the caller burns exactly
    /// `DISTRIBUTE_BURN_GARY` of THE $GARY mint here, or `burn = false` and
    /// `MONTHLY_SECS` have passed since the last distribution. Remaining accounts
    /// for the burn path: `[burner (signer), burner's $GARY account (mut),
    /// $GARY mint (mut), SPL Token program]`. Refused, and nothing burned, when
    /// the pool holds nothing undistributed or no vault is activated.
    ///
    /// A distribution only credits JOINED vaults; `claim` then delivers what
    /// was credited. Undistributed pool revenue is claimable by nobody, so a
    /// redeemer who leaves before the next distribution takes only what was
    /// already distributed, and the rest stays for the vaults that remain.
    ///
    /// EVERY DISTRIBUTION ADVANCES `dist_epoch` (stage 3c), which is what lets a
    /// vault that requested activation before it JOIN after it. When NO vault has
    /// joined yet (launch, or everyone has left) but some are waiting, the FREE
    /// path, once due, credits nothing and only advances the epoch so they can
    /// join. The burn path cannot do that: a first activator who could burn
    /// 100 $GARY to open the door alone would take the whole backlog with the
    /// next burn, which is the attack this exists to stop. A month after launch
    /// every charter member has had time to request.
    ///
    /// AND NO DISTRIBUTION WHILE A VAULT ALREADY ELIGIBLE TO JOIN IS WAITING
    /// (`JoinWaitingFirst`, refused before any $GARY is burned). Measured by the
    /// suite: without it, the first caller of a due month could tick the epoch,
    /// join only itself, and burn 100 $GARY to take the whole backlog while vaults
    /// that asked earlier were still unjoined. Joining them is free and anyone's.
    pub fn distribute<'info>(ctx: Context<'_, '_, '_, 'info, Distribute<'info>>, burn: bool) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool_owner = ctx.accounts.config.key();
        {
            let c = &ctx.accounts.config;
            require_keys_eq!(ctx.accounts.pool_token.key(), c.pool_ata, MintError::WrongPool);
        }
        let (balance, _) = read_token(&ctx.accounts.pool_token, &ctx.accounts.config.payment_mint, &pool_owner)?;
        // Before anything, and before any $GARY is burned: a DUE boost is expired
        // first (free, `claim`), so it never earns past the distributions it bought.
        require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst);
        let w = ctx.accounts.config.total_active_weight;
        if w == 0 {
            let c = &mut ctx.accounts.config;
            // Vaults already eligible need joining, not another tick.
            require!(waiting_to_join(c)? == 0, MintError::JoinWaitingFirst);
            require!(!burn && c.pending_this_epoch > 0, MintError::NoActiveVaults);
            require!(ctx.remaining_accounts.is_empty(), MintError::BadBurnAccounts);
            require!(now >= c.last_distribute_at.checked_add(c.monthly_secs).ok_or(MintError::Overflow)?,
                MintError::MonthNotElapsed);
            return tick(c, now);
        }
        let owed = ceil_sats(ctx.accounts.config.owed_scaled);
        let avail = balance.checked_sub(owed).ok_or(MintError::PoolShort)?;
        require!(avail > 0, MintError::NothingToDistribute);

        if burn {
            let rem = ctx.remaining_accounts;
            require!(rem.len() == 4, MintError::BadBurnAccounts);
            let (burner, from, gmint, tprog) = (&rem[0], &rem[1], &rem[2], &rem[3]);
            require!(burner.is_signer, MintError::BadBurnAccounts);
            require_keys_eq!(tprog.key(), SPL_TOKEN_ID, MintError::WrongGaryMint);
            // THE mint, by address, and CLASSIC SPL by owner: a Token-2022
            // lookalike or any other 9-decimal mint is refused before a CPI.
            require_keys_eq!(gmint.key(), GARY_MINT, MintError::WrongGaryMint);
            require_keys_eq!(*gmint.owner, SPL_TOKEN_ID, MintError::WrongGaryMint);
            // The burner's own $GARY account, holding at least the full amount.
            // Checked here so a short balance is a NAMED refusal, not the token
            // program's.
            let (bal, state) = read_token(from, &GARY_MINT, &burner.key())?;
            require!(state == TOKEN_STATE_INITIALIZED, MintError::InsufficientGary);
            require!(bal >= DISTRIBUTE_BURN_GARY, MintError::InsufficientGary);
            // Checked BEFORE the burn, so a refused distribution burns nothing.
            require!(waiting_to_join(&ctx.accounts.config)? == 0, MintError::JoinWaitingFirst);
            let mut data = vec![IX_SPL_BURN];
            data.extend_from_slice(&DISTRIBUTE_BURN_GARY.to_le_bytes());
            invoke(&Instruction {
                program_id: SPL_TOKEN_ID,
                accounts: vec![
                    AccountMeta::new(from.key(), false),
                    AccountMeta::new(gmint.key(), false),
                    AccountMeta::new_readonly(burner.key(), true),
                ],
                data,
            }, &[from.clone(), gmint.clone(), burner.clone(), tprog.clone()])?;
        } else {
            require!(ctx.remaining_accounts.is_empty(), MintError::BadBurnAccounts);
            require!(now >= ctx.accounts.config.last_distribute_at.checked_add(ctx.accounts.config.monthly_secs).ok_or(MintError::Overflow)?,
                MintError::MonthNotElapsed);
            require!(waiting_to_join(&ctx.accounts.config)? == 0, MintError::JoinWaitingFirst);
        }

        let c = &mut ctx.accounts.config;
        credit(c, avail, w, now)?;
        msg!("CBOB_DISTRIBUTED amount={} path={}", avail, if burn { "burn" } else { "monthly" });
        emit!(Distributed { amount: avail, total_weight: w, active_count: c.active_count,
            acc_scaled: c.acc_scaled, burned_gary: burn });
        Ok(())
    }

    /// Pay owed shares INTO EACH VAULT'S OWN cbBTC ACCOUNT. Permissionless,
    /// batched.
    ///
    /// Remaining accounts: if `crank > 0`, first `[SlotHashes, crank records...]`;
    /// then `(vault_record, vault_cbbtc_account)` pairs.
    ///   * The destination must be the account `activate` recorded. A missing or
    ///     non-token account REFUSES the whole call: a claim never creates one.
    ///   * A FROZEN destination (cbBTC has a live Coinbase freeze authority) is
    ///     SKIPPED, logged, and stays owed in full — it neither blocks the rest of
    ///     the batch nor is redistributed.
    ///   * An unactivated or retired vault is owed nothing and is skipped.
    ///   * A vault that REQUESTED activation and has seen a distribution since is
    ///     JOINED here (stage 3c), at the accumulator as it stands, so it is owed
    ///     nothing yet. One still waiting for its first distribution is skipped.
    pub fn claim<'info>(ctx: Context<'_, '_, '_, 'info, Claim<'info>>, crank_n: u8) -> Result<()> {
        let rem = ctx.remaining_accounts;
        let k = if crank_n == 0 { 0 } else { crank_n as usize + 1 };
        require!(rem.len() >= k, MintError::BadClaimList);
        crank(&rem[..k], Clock::get()?.slot)?;
        let pairs = &rem[k..];
        require!(!pairs.is_empty() && pairs.len() % 2 == 0, MintError::BadClaimList);
        require_keys_eq!(ctx.accounts.pool_token.key(), ctx.accounts.config.pool_ata, MintError::WrongPool);
        // BEFORE paying, so a claim that closes a month also delivers it.
        { let key = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
          let pool = ctx.accounts.pool_token.to_account_info();
          monthly_inline(&mut ctx.accounts.config, &pool, &key, now)?; }
        let acc = ctx.accounts.config.acc_scaled;
        let bump = ctx.accounts.config.bump;
        let mut owed_paid: u128 = 0;
        let (mut paid, mut n_paid, mut n_deferred, mut n_joined) = (0u64, 0u32, 0u32, 0u32);
        for pair in pairs.chunks(2) {
            let (ri, dest) = (&pair[0], &pair[1]);
            require!(ri.is_writable, MintError::BadVaultRecord);
            let mut r = load_record(ri)?;
            if r.pending {
                require_keys_eq!(dest.key(), r.vault_ata, MintError::WrongVaultAccount);
                if ctx.accounts.config.dist_epoch > r.request_epoch {
                    join(&mut ctx.accounts.config, &mut r)?;
                    store_record(ri, &r)?;
                    n_joined += 1;
                }
                // Joined at the accumulator as it stands: nothing is owed yet.
                continue;
            }
            if !r.active { continue; }
            require_keys_eq!(dest.key(), r.vault_ata, MintError::WrongVaultAccount);
            // A DUE boost expires here first, at the accumulator its last
            // distribution left (no distribution runs past it). The crank hands
            // every boosted vault to a claim after every distribution.
            let mut touched = false;
            if r.boost_weight > 0 && ctx.accounts.config.dist_epoch >= r.boost_end_epoch {
                expire_boost(&mut ctx.accounts.config, &mut r)?;
                touched = true;
            }
            let pending = owed_of(&r, acc)?;
            let pay = (pending / ACC_SCALE) as u64;
            if pay == 0 { if touched { store_record(ri, &r)?; } continue; }
            {
                require!(dest.owner == &SPL_TOKEN_ID && dest.lamports() > 0, MintError::VaultAccountMissing);
                let d = dest.try_borrow_data()?;
                require!(d.len() == TOKEN_ACCOUNT_LEN, MintError::VaultAccountMissing);
                if d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN {
                    msg!("CBOB_CLAIM_DEFERRED_FROZEN asset={} owed_sats={}", r.asset, pay);
                    emit!(ClaimDeferred { asset: r.asset, owed: pay });
                    n_deferred += 1;
                    if touched { store_record(ri, &r)?; }
                    continue;
                }
                require!(d[TOKEN_STATE_OFF] == TOKEN_STATE_INITIALIZED, MintError::VaultAccountMissing);
            }
            let mut data = vec![IX_TRANSFER];
            data.extend_from_slice(&pay.to_le_bytes());
            invoke_signed(&Instruction {
                program_id: SPL_TOKEN_ID,
                accounts: vec![
                    AccountMeta::new(ctx.accounts.pool_token.key(), false),
                    AccountMeta::new(dest.key(), false),
                    AccountMeta::new_readonly(ctx.accounts.config.key(), true),
                ],
                data,
            }, &[
                ctx.accounts.pool_token.to_account_info(),
                dest.clone(),
                ctx.accounts.config.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ], &[&[CONFIG_SEED, &[bump]]])?;
            let settled = (pay as u128) * ACC_SCALE;
            // Normalised: the sub-sat remainder is carried and the debt restarts
            // at the vault's weight now.
            r.carry_scaled = pending.checked_sub(settled).ok_or(MintError::Overflow)?;
            r.debt_scaled = (weight_of(&r)? as u128).checked_mul(acc).ok_or(MintError::Overflow)?;
            store_record(ri, &r)?;
            owed_paid = owed_paid.checked_add(settled).ok_or(MintError::Overflow)?;
            paid = paid.checked_add(pay).ok_or(MintError::Overflow)?;
            n_paid += 1;
        }
        let c = &mut ctx.accounts.config;
        c.owed_scaled = c.owed_scaled.checked_sub(owed_paid).ok_or(MintError::Overflow)?;
        emit!(Claimed { vaults_paid: n_paid, vaults_deferred: n_deferred, vaults_joined: n_joined, paid });
        Ok(())
    }

    /// CALLED BY BURN, BY CPI, FROM INSIDE `burn_vault`, AND BY NOTHING ELSE.
    ///
    /// Every redemption ends here. It REFUSES while a whole sat is still owed to
    /// the vault — the redeemer puts `claim` before the sweep in the same
    /// transaction, so the share is paid into the vault and swept out with the
    /// rest — then removes the vault's weight. A sub-sat residue goes back to the
    /// pool. Proven to come from BURN by stack height (a direct CPI from the
    /// top-level instruction) and by that top-level instruction being BURN's
    /// `burn_vault` for this asset.
    pub fn retire_redeemed(ctx: Context<RetireRedeemed>) -> Result<()> {
        require!(get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1, MintError::NotFromBurn);
        {
            let sysvar = ctx.accounts.instructions.to_account_info();
            let cur = load_current_index_checked(&sysvar)? as usize;
            let ix = load_instruction_at_checked(cur, &sysvar)?;
            require!(ix.program_id == BURN_PROGRAM_ID
                && ix.data.len() >= IX_BURN_VAULT_DISC.len()
                && ix.data[..IX_BURN_VAULT_DISC.len()] == IX_BURN_VAULT_DISC
                && ix.accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(ctx.accounts.asset.key()),
                MintError::NotFromBurn);
        }
        require_keys_eq!(ctx.accounts.asset.key(), ctx.accounts.vault_record.asset, MintError::WrongAsset);
        require!(is_burned(&ctx.accounts.asset)?, MintError::NotBurned);
        // A FROZEN POOL NEVER LOCKS A VAULT (red-team 3 finding 1). cbBTC has a
        // live freeze authority (Coinbase); a frozen pool refuses every `claim`,
        // and without this every activated vault would be unopenable for as long
        // as the freeze lasted, because a redemption must settle what it is owed
        // first. With the pool frozen the redemption goes through and its
        // undelivered share returns to the pool, like a bare burn's. "A member can
        // always get their Bitcoin out."
        let forfeit = pool_is_frozen(&ctx.accounts.pool_token, &ctx.accounts.config)?;
        retire(&mut ctx.accounts.config, &mut ctx.accounts.vault_record, true, forfeit)?;
        // AFTER the retire, deliberately: the redeemed vault has already left the
        // schedule, so a monthly run landing in its own redemption credits only
        // the vaults that stay (it could not be claimed into a burned vault, and
        // crediting it first would refuse the redemption as ClaimBeforeBurn).
        let k = ctx.accounts.config.key(); let now = Clock::get()?.unix_timestamp;
        monthly_inline(&mut ctx.accounts.config, &ctx.accounts.pool_token, &k, now)
    }

    /// Retire a vault its owner destroyed with a BARE Core `BurnV1` (proven
    /// impossibility 1: it cannot be prevented). Permissionless.
    ///
    /// Burned is identified POSITIVELY (round 21): Core-owned, one byte,
    /// `Key::Uninitialized`. Its weight leaves the schedule, its unclaimed share
    /// returns to the pool, and it is counted for GOV's live supply.
    pub fn retire_burned(ctx: Context<RetireBurned>) -> Result<()> {
        require_keys_eq!(ctx.accounts.asset.key(), ctx.accounts.vault_record.asset, MintError::WrongAsset);
        require!(is_burned(&ctx.accounts.asset)?, MintError::NotBurned);
        retire(&mut ctx.accounts.config, &mut ctx.accounts.vault_record, false, false)
    }
}

/// Take a vault off the schedule. `redeemed`: the owner's own redemption through
/// BURN (counted by BURN), which must have claimed first; otherwise a bare burn,
/// whose pending share is returned to the pool and which is counted here.
fn retire(c: &mut MintConfig, r: &mut VaultRecord, redeemed: bool, forfeit: bool) -> Result<()> {
    require!(!r.retired, MintError::AlreadyRetired);
    let mut returned: u128 = 0;
    if r.active {
        let w = weight_of(r)?;
        let full = (w as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
        let pending = owed_of(r, c.acc_scaled)?;
        if redeemed && !forfeit { require!(pending < ACC_SCALE, MintError::ClaimBeforeBurn); }
        if forfeit && pending >= ACC_SCALE {
            msg!("CBOB_REDEEMED_POOL_FROZEN asset={} forfeited_sats={}", r.asset, pending / ACC_SCALE);
        }
        c.owed_scaled = c.owed_scaled.checked_sub(pending).ok_or(MintError::Overflow)?;
        c.total_active_weight = c.total_active_weight.checked_sub(w).ok_or(MintError::Overflow)?;
        c.active_count = c.active_count.checked_sub(1).ok_or(MintError::Overflow)?;
        // A boost leaves with the vault, from wherever it is in the schedule.
        if r.boost_weight > 0 { unschedule_boost(c, r)?; }
        r.debt_scaled = full;
        r.carry_scaled = 0;
        r.active = false;
        returned = pending;
    }
    // A vault still waiting to join holds no weight and is owed nothing; it only
    // leaves the queue.
    if r.pending {
        c.pending_count = c.pending_count.checked_sub(1).ok_or(MintError::Overflow)?;
        if r.request_epoch == c.dist_epoch {
            c.pending_this_epoch = c.pending_this_epoch.checked_sub(1).ok_or(MintError::Overflow)?;
        }
        r.pending = false;
    }
    r.retired = true;
    if !redeemed { c.bare_burns_retired = c.bare_burns_retired.checked_add(1).ok_or(MintError::Overflow)?; }
    emit!(VaultRetired { asset: r.asset, redeemed, returned_to_pool_sats: (returned / ACC_SCALE) as u64,
        total_weight: c.total_active_weight, bare_burns_retired: c.bare_burns_retired });
    Ok(())
}

/// The distribution's accounting, ONE copy, used by `distribute` and by the
/// monthly in-line run. Every distribution is a new epoch (stage 3c).
fn credit(c: &mut MintConfig, avail: u64, w: u64, now: i64) -> Result<()> {
    let delta = (avail as u128).checked_mul(ACC_SCALE).ok_or(MintError::Overflow)? / (w as u128);
    c.acc_scaled = c.acc_scaled.checked_add(delta).ok_or(MintError::Overflow)?;
    c.owed_scaled = c.owed_scaled.checked_add(delta.checked_mul(w as u128).ok_or(MintError::Overflow)?)
        .ok_or(MintError::Overflow)?;
    c.last_distribute_at = now;
    advance_epoch(c)
}

/// EVERY distribution and every empty tick passes through here, ONCE: the epoch
/// moves, the activation requests of the closing epoch become eligible to join,
/// and the boosts whose last distribution this was become DUE.
fn advance_epoch(c: &mut MintConfig) -> Result<()> {
    c.dist_epoch = c.dist_epoch.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_this_epoch = 0;
    let i = (c.dist_epoch % BOOST_RING as u64) as usize;
    c.boosts_due = c.boosts_due.checked_add(c.boost_expiring[i]).ok_or(MintError::Overflow)?;
    c.boost_expiring[i] = 0;
    Ok(())
}

/// A vault's weight now: its level's, plus a live boost's.
fn weight_of(r: &VaultRecord) -> Result<u64> {
    require!((1..=5).contains(&r.level), MintError::NotRevealed);
    Ok(LEVEL_WEIGHTS[(r.level - 1) as usize] + r.boost_weight as u64)
}

/// What a vault is owed, scaled: `weight * acc - debt + carry`.
fn owed_of(r: &VaultRecord, acc: u128) -> Result<u128> {
    // carry added BEFORE the debt is taken: after a weight change the debt is
    // `weight * acc` exactly, and a claim's settlement can leave it above that.
    (weight_of(r)? as u128).checked_mul(acc).ok_or(MintError::Overflow)?
        .checked_add(r.carry_scaled).ok_or(MintError::Overflow)?
        .checked_sub(r.debt_scaled).ok_or(error!(MintError::Overflow))
}

/// Change a live vault's boost (and so its weight) WITHOUT touching what it has
/// earned: the owed share moves to `carry`, the debt restarts at the new weight,
/// and the payout denominator moves by the difference. Nothing is credited or
/// owed anew, so `owed_scaled` does not change.
fn reweigh(c: &mut MintConfig, r: &mut VaultRecord, boost: u8) -> Result<()> {
    require!(r.active, MintError::BoostNeedsActiveVault);
    let before = weight_of(r)?;
    let owed = owed_of(r, c.acc_scaled)?;
    r.boost_weight = boost;
    let after = weight_of(r)?;
    r.carry_scaled = owed;
    r.debt_scaled = (after as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
    c.total_active_weight = c.total_active_weight.checked_sub(before).ok_or(MintError::Overflow)?
        .checked_add(after).ok_or(MintError::Overflow)?;
    Ok(())
}

/// Take a live boost out of the schedule, DUE or not, and out of the totals.
/// The caller changes the vault's weight.
fn unschedule_boost(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    if c.dist_epoch >= r.boost_end_epoch {
        c.boosts_due = c.boosts_due.checked_sub(1).ok_or(MintError::Overflow)?;
    } else {
        let i = (r.boost_end_epoch % BOOST_RING as u64) as usize;
        c.boost_expiring[i] = c.boost_expiring[i].checked_sub(1).ok_or(MintError::Overflow)?;
    }
    c.boosts_active = c.boosts_active.checked_sub(1).ok_or(MintError::Overflow)?;
    c.boost_weight_total = c.boost_weight_total.checked_sub(r.boost_weight as u64).ok_or(MintError::Overflow)?;
    Ok(())
}

/// Expire a DUE boost: it has earned every distribution it was bought for, and
/// no distribution has run since (`BoostsExpireFirst`), so the accumulator is
/// exactly where its last one left it.
fn expire_boost(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    require!(r.boost_weight > 0 && c.dist_epoch >= r.boost_end_epoch, MintError::BoostNotDue);
    let extra = r.boost_weight;
    unschedule_boost(c, r)?;
    reweigh(c, r, 0)?;
    r.boost_end_epoch = 0;
    msg!("CBOB_BOOST_EXPIRED asset={} weight={}", r.asset, extra);
    emit!(BoostExpired { asset: r.asset, extra_weight: extra, epoch: c.dist_epoch,
        total_weight: c.total_active_weight });
    Ok(())
}

/// Vaults that requested activation in an EARLIER epoch and have not joined yet
/// (stage 3c). While any exist no distribution may credit: they are owed a place
/// in it, and the instant they are joined their debt is exact (`w * acc` with acc
/// unchanged since their eligibility). Without this, whoever reached a due month
/// first could tick, join ONLY themselves and take the next distribution alone
/// while vaults that asked earlier sat unjoined. Anyone may join them, free, with
/// `claim` (our crank does it right after every distribution).
fn waiting_to_join(c: &MintConfig) -> Result<u64> {
    Ok(c.pending_count.checked_sub(c.pending_this_epoch).ok_or(MintError::Overflow)?)
}

/// A distribution with nobody joined to credit (stage 3c): the period is spent
/// and the epoch advances, so the vaults waiting can join. Nothing moves; the
/// pool keeps everything for the first real distribution after they join.
fn tick(c: &mut MintConfig, now: i64) -> Result<()> {
    c.last_distribute_at = now;
    advance_epoch(c)?;
    msg!("CBOB_EPOCH_TICK epoch={} waiting={}", c.dist_epoch, c.pending_count);
    Ok(())
}

/// Put a vault that requested activation on the schedule (stage 3c). Only ever
/// called once `dist_epoch > request_epoch`: it missed the distribution that
/// followed its request, enters at the accumulator as it now stands, and earns
/// from the next one.
fn join(c: &mut MintConfig, r: &mut VaultRecord) -> Result<()> {
    require!(r.pending && !r.active && !r.retired && c.dist_epoch > r.request_epoch, MintError::ActivationPending);
    let w = LEVEL_WEIGHTS[(r.level - 1) as usize];
    c.total_active_weight = c.total_active_weight.checked_add(w).ok_or(MintError::Overflow)?;
    c.active_count = c.active_count.checked_add(1).ok_or(MintError::Overflow)?;
    c.pending_count = c.pending_count.checked_sub(1).ok_or(MintError::Overflow)?;
    r.pending = false;
    r.active = true;
    r.debt_scaled = (w as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
    r.carry_scaled = 0;
    emit!(VaultActivated { asset: r.asset, level: r.level, weight: w, total_weight: c.total_active_weight,
        active_count: c.active_count, epoch: c.dist_epoch });
    Ok(())
}

/// THE MONTHLY DISTRIBUTION, RUN BY ORDINARY TRAFFIC (Gary, 2026-10-03: "the
/// monthly path should run programmatically without any human interaction and
/// require NO $GARY burn"). Every host instruction (`mint_vault`,
/// `claim_charter_vault`, `activate`, `claim`, and the redemption through
/// `retire_redeemed`) carries the pool account and calls this. When 30 days have
/// passed since the last distribution and the pool holds something undistributed
/// for at least one activated vault, it credits exactly as `distribute` does;
/// otherwise it does NOTHING, and it NEVER refuses its host for those reasons.
/// The only refusal is a WRONG pool account: if a junk account could stand in for
/// the pool, any caller could suppress the monthly run for ever.
///
/// Exactly one per period: it stamps `last_distribute_at`, so a second host in
/// the same slot sees the period as not due.
fn monthly_inline(c: &mut MintConfig, pool: &AccountInfo, config_key: &Pubkey, now: i64) -> Result<()> {
    require_keys_eq!(pool.key(), c.pool_ata, MintError::WrongPool);
    let due = match c.last_distribute_at.checked_add(c.monthly_secs) { Some(t) => now >= t, None => false };
    if !due { return Ok(()); }
    // Never credit past a DUE boost either (see `BOOST_RING`); the crank expires
    // them right after every distribution, and the next host runs the month.
    if c.boosts_due > 0 {
        msg!("CBOB_MONTHLY_WAITS_FOR_BOOSTS due={}", c.boosts_due);
        return Ok(());
    }
    // Nobody joined yet but some waiting: open the door (see `distribute`).
    if waiting_to_join(c)? > 0 {
        // Never credit past a vault already eligible to join (see `waiting_to_join`);
        // the run happens on the first host after the crank has joined them.
        msg!("CBOB_MONTHLY_WAITS_FOR_JOINS waiting={}", waiting_to_join(c)?);
        return Ok(());
    }
    if c.total_active_weight == 0 {
        if c.pending_this_epoch > 0 { tick(c, now)?; }
        return Ok(());
    }
    // A pool account that is not (yet) a live token account of ours holds nothing.
    if pool.owner != &SPL_TOKEN_ID { return Ok(()); }
    let balance = {
        let d = pool.try_borrow_data()?;
        if d.len() != TOKEN_ACCOUNT_LEN || d[0..32] != c.payment_mint.to_bytes() || d[32..64] != config_key.to_bytes() {
            return Ok(());
        }
        // A FROZEN pool can deliver nothing; crediting from it would only make
        // every vault owed again, and owed vaults are what a redemption settles.
        if d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN { return Ok(()); }
        u64::from_le_bytes(d[64..72].try_into().unwrap())
    };
    let avail = balance.saturating_sub(ceil_sats(c.owed_scaled));
    if avail == 0 { return Ok(()); }
    let w = c.total_active_weight;
    credit(c, avail, w, now)?;
    msg!("CBOB_DISTRIBUTED amount={} path=monthly_inline", avail);
    emit!(Distributed { amount: avail, total_weight: w, active_count: c.active_count,
        acc_scaled: c.acc_scaled, burned_gary: false });
    Ok(())
}

fn ceil_sats(scaled: u128) -> u64 {
    ((scaled + ACC_SCALE - 1) / ACC_SCALE) as u64
}

/// Is THE pool (by address) a frozen token account? Anything else reads false.
fn pool_is_frozen(pool: &AccountInfo, c: &MintConfig) -> Result<bool> {
    require_keys_eq!(pool.key(), c.pool_ata, MintError::WrongPool);
    if pool.owner != &SPL_TOKEN_ID { return Ok(false); }
    let d = pool.try_borrow_data()?;
    Ok(d.len() == TOKEN_ACCOUNT_LEN && d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN)
}

/// Positively burned: Core-owned, one byte, `Key::Uninitialized` (round 21: absent
/// is not burned, and a closed or system-owned account is not burned either).
fn is_burned(a: &AccountInfo) -> Result<bool> {
    let d = a.try_borrow_data()?;
    Ok(*a.owner == MPL_CORE_ID && d.len() == 1 && d[0] == 0)
}

fn require_live_vault(a: &AccountInfo, collection: &Pubkey) -> Result<()> {
    require_keys_eq!(*a.owner, MPL_CORE_ID, MintError::NotALiveVault);
    let d = a.try_borrow_data()?;
    require!(d.len() >= 66 && d[0] == KEY_ASSET_V1 && d[33] == UA_DISC_COLLECTION, MintError::NotALiveVault);
    let mut c = [0u8; 32]; c.copy_from_slice(&d[34..66]);
    require_keys_eq!(Pubkey::new_from_array(c), *collection, MintError::NotALiveVault);
    Ok(())
}

/// A classic SPL token account of `mint` owned by `owner`: (amount, state).
fn read_token(a: &AccountInfo, mint: &Pubkey, owner: &Pubkey) -> Result<(u64, u8)> {
    require!(a.owner == &SPL_TOKEN_ID, MintError::VaultAccountMissing);
    let d = a.try_borrow_data()?;
    require!(d.len() == TOKEN_ACCOUNT_LEN, MintError::VaultAccountMissing);
    let mut m = [0u8; 32]; m.copy_from_slice(&d[0..32]);
    let mut o = [0u8; 32]; o.copy_from_slice(&d[32..64]);
    require_keys_eq!(Pubkey::new_from_array(m), *mint, MintError::WrongVaultAccount);
    require_keys_eq!(Pubkey::new_from_array(o), *owner, MintError::WrongVaultAccount);
    Ok((u64::from_le_bytes(d[64..72].try_into().unwrap()), d[TOKEN_STATE_OFF]))
}

fn load_record(a: &AccountInfo) -> Result<VaultRecord> {
    require_keys_eq!(*a.owner, crate::ID, MintError::BadVaultRecord);
    let d = a.try_borrow_data()?;
    let r = VaultRecord::try_deserialize(&mut &d[..]).map_err(|_| error!(MintError::BadVaultRecord))?;
    require!(r.version == VAULT_RECORD_VERSION, MintError::BadVaultRecord);
    Ok(r)
}

fn store_record(a: &AccountInfo, r: &VaultRecord) -> Result<()> {
    let mut d = a.try_borrow_mut_data()?;
    let mut w: &mut [u8] = &mut d[..];
    r.try_serialize(&mut w)?;
    Ok(())
}

fn reschedule(r: &mut VaultRecord, now: u64) -> Result<()> {
    let old = r.reveal_slot;
    r.reveal_slot = now.checked_add(REVEAL_LEAD_SLOTS).ok_or(MintError::Overflow)?;
    r.reschedules = r.reschedules.saturating_add(1);
    // A DISTINCT LOG LINE, so the alarm can page on it without decoding events.
    msg!("CBOB_REVEAL_RESCHEDULED asset={} mint_index={} old_slot={} new_slot={} times={}",
        r.asset, r.mint_index, old, r.reveal_slot, r.reschedules);
    emit!(RevealRescheduled { asset: r.asset, mint_index: r.mint_index, old_reveal_slot: old,
        new_reveal_slot: r.reveal_slot, reschedules: r.reschedules });
    Ok(())
}

/// THE OPPORTUNISTIC CRANK. `accts` is empty, or `[SlotHashes, record...]` with
/// at most `MAX_CRANK` records. Each record still waiting for entropy is captured
/// if its slot hash is in the window, rescheduled if the window has passed, and
/// left alone if it is too early. An account that is not a writable VaultRecord
/// of this program is SKIPPED, never trusted and never fatal: the crank rides on
/// a member's mint or claim and must not be a way to make that fail.
fn crank(accts: &[AccountInfo], now: u64) -> Result<()> {
    if accts.is_empty() { return Ok(()); }
    require_keys_eq!(accts[0].key(), slot_hashes::ID, MintError::BadSlotHashes);
    require!(accts.len() - 1 <= MAX_CRANK, MintError::TooManyCranked);
    for a in accts[1..].iter() {
        if !a.is_writable || a.owner != &crate::ID { continue; }
        let mut r = match load_record(a) { Ok(r) => r, Err(_) => continue };
        if r.level != 0 || r.entropy_set { continue; }
        match try_capture(&accts[0], r.reveal_slot, now, &r.asset)? {
            Capture::Got(e) => { r.entropy = e; r.entropy_set = true; }
            Capture::Expired => reschedule(&mut r, now)?,
            Capture::NotYet => continue,
        }
        store_record(a, &r)?;
    }
    Ok(())
}

enum Capture { Got([u8; 32]), NotYet, Expired }

/// The one place entropy is read. `now` is the current slot; SlotHashes holds
/// ancestors only, so a slot below `now` that is absent was SKIPPED on this fork,
/// and the smallest produced slot at or after `reveal_slot` is therefore final the
/// moment it appears.
/// THE CAPTURE DEADLINE is set by the EARLIEST hash, A: it must still be in the
/// 512-slot buffer. A is at most `reveal_slot + MAX_SKIPPED_SLOTS`, and the window
/// closes at `reveal_slot + REVEAL_WINDOW_SLOTS`, so A is always still there; C is
/// at most ~3 x (8 + MAX_SKIPPED_SLOTS) past `reveal_slot`, inside the window.
fn try_capture(sh: &AccountInfo, reveal_slot: u64, now: u64, asset: &Pubkey) -> Result<Capture> {
    if now <= reveal_slot { return Ok(Capture::NotYet); }
    if now > reveal_slot.checked_add(REVEAL_WINDOW_SLOTS).ok_or(MintError::Overflow)? {
        return Ok(Capture::Expired);
    }
    // A, then B and C each ENTROPY_GROUP_STRIDE leader groups after the last.
    // Deterministic: which slots the chain produced is settled before this runs.
    let mut want = reveal_slot;
    let mut hs: [[u8; 32]; 3] = [[0u8; 32]; 3];
    for h in hs.iter_mut() {
        match blockhash_in_window(sh, want)? {
            Some((hash, slot)) => {
                *h = hash;
                want = (slot / LEADER_GROUP_SLOTS).checked_add(ENTROPY_GROUP_STRIDE).ok_or(MintError::Overflow)?
                    .checked_mul(LEADER_GROUP_SLOTS).ok_or(MintError::Overflow)?;
            }
            // Not produced yet (or every slot so far was skipped). Wait; the
            // window bounds the wait and a reschedule follows it.
            None => return Ok(Capture::NotYet),
        }
    }
    Ok(Capture::Got(hashv(&[&hs[0], &hs[1], &hs[2], asset.as_ref()]).to_bytes()))
}

fn push_attr(data: &mut Vec<u8>, k: &str, v: &str) {
    data.extend_from_slice(&(k.len() as u32).to_le_bytes());
    data.extend_from_slice(k.as_bytes());
    data.extend_from_slice(&(v.len() as u32).to_le_bytes());
    data.extend_from_slice(v.as_bytes());
}

/// The three supply ceilings, one place. A vault may only be minted if a level is
/// still available for it, so every vault minted is guaranteed a draw.
fn check_supply(cfg: &MintConfig) -> Result<()> {
    require!(cfg.minted_total < cfg.max_supply, MintError::SupplyCapReached);
    let cap_total: u64 = cfg.level_caps.iter().map(|c| *c as u64).sum();
    require!(cfg.minted_total < cap_total, MintError::LevelCapReached);
    Ok(())
}

fn check_attributes(attributes: &[VaultAttribute], budget: usize) -> Result<()> {
    require!(attributes.len() <= budget, MintError::TooManyAttributes);
    for (i, a) in attributes.iter().enumerate() {
        require!(a.key.len() <= MAX_ATTR_STR && a.value.len() <= MAX_ATTR_STR, MintError::TooManyAttributes);
        require!(!a.key.is_empty(), MintError::TooManyAttributes);
        require!(a.key != ATTR_REDEMPTION && a.key != ATTR_LEVEL && a.key != ATTR_CHARTER,
            MintError::ReservedAttribute);
        // Duplicate keys: a map a reader takes money decisions from may not have
        // two answers (accepted limit 14, closed).
        require!(!attributes[..i].iter().any(|b| b.key == a.key), MintError::DuplicateAttribute);
    }
    Ok(())
}

/// The SEAL config is the CANONICAL wiring. Read it, do not duplicate it.
fn check_seal_wiring(seal_config: &UncheckedAccount, collection: &Pubkey) -> Result<()> {
    let (expected_cfg, _) = Pubkey::find_program_address(&[SEAL_CONFIG_SEED], &SEAL_PROGRAM_ID);
    require_keys_eq!(seal_config.key(), expected_cfg, MintError::BadSealConfig);
    require_keys_eq!(*seal_config.owner, SEAL_PROGRAM_ID, MintError::BadSealConfig);
    let d = seal_config.try_borrow_data()?;
    require!(d.len() >= OFF_COLLECTION + 32, MintError::BadSealConfig);
    require!(d[..8] == SEAL_CONFIG_DISC, MintError::BadSealConfig);
    require!(d[OFF_VERSION] == SEAL_CONFIG_VERSION, MintError::SealConfigVersion);
    let mut c = [0u8; 32]; c.copy_from_slice(&d[OFF_COLLECTION..OFF_COLLECTION + 32]);
    require_keys_eq!(Pubkey::new_from_array(c), *collection, MintError::WiringDiverged);
    Ok(())
}

/// SEAL's reserve list, read from the same pinned config (`check_seal_wiring`
/// must have passed first). Layout: u32 count at 41, then 32-byte keys.
fn seal_reserves(seal_config: &UncheckedAccount) -> Result<Vec<Pubkey>> {
    let d = seal_config.try_borrow_data()?;
    require!(d.len() >= OFF_RESERVES + 4, MintError::BadSealConfig);
    let n = u32::from_le_bytes(d[OFF_RESERVES..OFF_RESERVES + 4].try_into().unwrap()) as usize;
    require!(n <= 3 && d.len() >= OFF_RESERVES + 4 + n * 32, MintError::BadSealConfig);
    Ok((0..n).map(|i| {
        let o = OFF_RESERVES + 4 + i * 32;
        let mut k = [0u8; 32]; k.copy_from_slice(&d[o..o + 32]);
        Pubkey::new_from_array(k)
    }).collect())
}

/// CreateV2 with the HARDCODED plugin set: the seal (PermanentFreezeExecute,
/// authority the SEAL program's PDA, born frozen) and the provenance Attributes,
/// whose authority is THIS program's PDA so `reveal_level` can append the level.
/// No other instruction here ever writes to a vault's attributes.
#[allow(clippy::too_many_arguments)]
fn create_vault<'info>(
    asset: &Signer<'info>, collection: &UncheckedAccount<'info>, mint_authority: &UncheckedAccount<'info>,
    payer: &Signer<'info>, owner: &Signer<'info>, mpl_core: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>, bump: u8,
    name: &str, uri: &str, attributes: &[VaultAttribute],
) -> Result<()> {
    require!(name.len() <= MAX_NAME_LEN, MintError::NameTooLong);
    require!(uri.len() <= MAX_URI_LEN, MintError::UriTooLong);
    let (seal_pda, _) = Pubkey::find_program_address(&[SEAL_SEED], &SEAL_PROGRAM_ID);
    let mut data: Vec<u8> = vec![IX_CREATE_V2, 0];
    data.extend_from_slice(&(name.len() as u32).to_le_bytes());
    data.extend_from_slice(name.as_bytes());
    data.extend_from_slice(&(uri.len() as u32).to_le_bytes());
    data.extend_from_slice(uri.as_bytes());
    data.push(1);
    data.extend_from_slice(&2u32.to_le_bytes());
    data.push(PLUGIN_PERMANENT_FREEZE_EXECUTE);
    data.push(1); // frozen
    data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref());
    data.push(PLUGIN_ATTRIBUTES);
    data.extend_from_slice(&(attributes.len() as u32).to_le_bytes());
    for a in attributes.iter() { push_attr(&mut data, &a.key, &a.value); }
    data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(mint_authority.key().as_ref());
    data.push(1); data.extend_from_slice(&0u32.to_le_bytes());
    invoke_signed(&Instruction {
        program_id: MPL_CORE_ID,
        accounts: vec![
            AccountMeta::new(asset.key(), true),
            AccountMeta::new(collection.key(), false),
            AccountMeta::new_readonly(mint_authority.key(), true),
            AccountMeta::new(payer.key(), true),
            AccountMeta::new_readonly(owner.key(), false),
            AccountMeta::new_readonly(MPL_CORE_ID, false),
            AccountMeta::new_readonly(system_program.key(), false),
            AccountMeta::new_readonly(MPL_CORE_ID, false),
        ],
        data,
    }, &[
        asset.to_account_info(), collection.to_account_info(), mint_authority.to_account_info(),
        payer.to_account_info(), owner.to_account_info(), mpl_core.to_account_info(),
        system_program.to_account_info(),
    ], &[&[MINT_SEED, &[bump]]])?;
    Ok(())
}

fn write_record(r: &mut Account<VaultRecord>, asset: Pubkey, index: u64, slot: u64, charter: bool,
                attributes: &[VaultAttribute], bump: u8) -> Result<()> {
    // THE ATTRIBUTE BUDGET: what is stored here is what the reveal must re-send.
    let bytes: usize = attributes.iter().map(|a| 8 + a.key.len() + a.value.len()).sum();
    require!(bytes <= MAX_ATTR_BYTES, MintError::AttributesTooLarge);
    r.version = VAULT_RECORD_VERSION;
    r.asset = asset;
    r.mint_index = index;
    r.reveal_slot = slot.checked_add(REVEAL_LEAD_SLOTS).ok_or(MintError::Overflow)?;
    r.level = 0;
    r.charter = charter;
    r.entropy_set = false;
    r.entropy = [0; 32];
    r.attrs_hash = hashv(&[&attributes.to_vec().try_to_vec()?]).to_bytes();
    r.bump = bump;
    Ok(())
}

#[account]
pub struct MintConfig {
    /// Layout version, FIRST field at a fixed offset. The GOV program reads this
    /// account by raw offset (`governance` at 41, `minted_total` at 141) to
    /// snapshot a proposal and to confirm it is named as governance. Every field
    /// is fixed-size on purpose, so no offset depends on another field's value.
    pub version: u8,
    pub collection: Pubkey,
    /// The GOV program's ["gov"] PDA, from `initialize`, forever.
    pub governance: Pubkey,
    /// THE POOL: the holders' 85% destination, the config PDA's own ATA for the
    /// payment mint. Derived at `initialize`; no instruction writes it again.
    /// (Offset 73, where v5's distributor wallet used to be.)
    pub pool_ata: Pubkey,
    pub round_id: u32,
    pub opens_at: i64,
    pub closes_at: i64,
    /// The voted round's price, in the payment mint's base units (sats of cbBTC).
    pub price: u64,
    pub cap: u32,
    pub minted_this_round: u32,
    /// Never reset; it is also every vault's mint index. Counts charter claims.
    pub minted_total: u64,
    /// Hard lifetime ceiling on vaults that can ever exist. Fixed at `initialize`;
    /// stage 3b removed the vote that could ratchet it down.
    pub max_supply: u64,
    /// The project's 15% destination (the CBOBTC Squads). The name predates v6.
    pub bank_treasury: Pubkey,
    pub split_bps: u16,
    pub sales_stopped: bool,
    pub sweep_stopped: bool,
    pub guardian: Pubkey,
    pub swap_operator: Pubkey,
    pub sol_reserve_lamports: u64,
    pub bump: u8,
    pub max_sweep_lamports: u64,
    pub sweep_cooldown_secs: i64,
    pub last_sweep_at: i64,
    /// How many vaults may ever be drawn at each level, I..V at index 0..4.
    pub level_caps: [u32; 5],
    /// How many have been DRAWN at each level (counted at reveal).
    pub level_minted: [u32; 5],
    /// How many vaults have had their level drawn; the next to reveal is this index.
    pub revealed_total: u64,
    /// cbBTC on mainnet. Voted rounds are paid in it.
    pub payment_mint: Pubkey,
    /// The collection the Proof of Burn assets live in (Giraffish Moments).
    pub pob_collection: Pubkey,
    /// Merkle root of the 240 Proof of Burn asset ADDRESSES.
    pub pob_root: [u8; 32],
    pub charter_opens_at: i64,
    pub charter_closes_at: i64,
    pub charter_claimed: u32,
    // ── v6 stage 3: the community pool. GOV reads `bare_burns_retired` at 454. ──
    /// Vaults destroyed by a BARE Core burn and retired here. GOV's live supply is
    /// `minted_total - BURN.burned_total - bare_burns_retired`.
    pub bare_burns_retired: u64,
    /// Sum of the level weights of every ACTIVATED vault: the payout denominator.
    pub total_active_weight: u64,
    pub active_count: u64,
    /// Cumulative payout per unit of weight, scaled by `ACC_SCALE`.
    pub acc_scaled: u128,
    /// Distributed and not yet claimed, scaled. The pool balance never falls
    /// below `ceil(owed_scaled / ACC_SCALE)`.
    pub owed_scaled: u128,
    pub last_distribute_at: i64,
    // (stage 3b: `emission_min` is deleted with the cadence it fed; a distribution
    // is a 100 $GARY burn or `monthly_secs` since `last_distribute_at`.)
    // ── v6 stage 3b (version 4), appended so no earlier offset moves ──
    /// When each guardian stop last went from off to on. `restart` refuses a
    /// proposal created before it.
    pub sales_stopped_at: i64,
    pub sweep_stopped_at: i64,
    /// A voted replacement swap operator and when it was armed; it lands after
    /// `notice_secs` via the permissionless `apply_swap_operator`.
    pub pending_swap_operator: Pubkey,
    pub pending_swap_operator_at: i64,
    /// The free distribution period: 30 days on mainnet (`MONTHLY_SECS`).
    pub monthly_secs: i64,
    // ── v6 stage 3c (version 5), appended so no earlier offset moves ──
    /// A voted replacement guardian (`pending_guardian_set`, since `None` is a
    /// legal outcome), and when it was armed; it lands after `notice_secs` via
    /// the permissionless `apply_guardian`.
    pub pending_guardian: Pubkey,
    pub pending_guardian_set: bool,
    pub pending_guardian_at: i64,
    /// Public notice before a voted guardian or swap operator takes office: 7 days
    /// on mainnet (`NOTICE_SECS`).
    pub notice_secs: i64,
    /// THE TIGHTEN BOUNDS, fixed at `initialize`: no vote may push the per-sweep
    /// cap below the floor, the cooldown above its ceiling, or the reserve above
    /// its ceiling.
    pub sweep_floor_lamports: u64,
    pub cooldown_ceiling_secs: i64,
    pub reserve_ceiling_lamports: u64,
    /// How many distributions (including empty epoch ticks) have run. A vault
    /// that requested activation in epoch `e` joins once this is above `e`.
    pub dist_epoch: u64,
    /// Vaults that have requested activation and not yet joined.
    pub pending_count: u64,
    /// ...of which requested in the CURRENT epoch (not yet eligible to join).
    pub pending_this_epoch: u64,
    // ── the $CBOB boost (version 6), appended so no earlier offset moves ──
    /// THE $CBOB mint, classic SPL, pinned at `initialize`. Nothing writes it again.
    pub cbob_mint: Pubkey,
    /// The bounds every voted term must sit inside, fixed at `initialize`.
    pub max_boost_weight: u8,
    pub max_boost_epochs: u16,
    /// The voted terms. `boost_price` is $CBOB base units burned per boost; 0 means
    /// boosts are OFF (the launch state).
    pub boost_price: u64,
    pub boost_weight: u8,
    pub boost_epochs: u16,
    /// Boosts bought and not yet expired, and of those how many are DUE (their
    /// last distribution has run). No distribution while `boosts_due > 0`.
    pub boosts_active: u32,
    pub boosts_due: u32,
    /// The extra weight all live boosts add to `total_active_weight`.
    pub boost_weight_total: u64,
    /// Every $CBOB base unit this program has ever burned for a boost.
    pub cbob_burned_total: u64,
    /// How many live boosts end at each epoch, at `epoch % BOOST_RING`.
    pub boost_expiring: [u32; BOOST_RING],
}

/// One per vault, `["vault", asset]`. ⚠️ GOV reads `mint_index` by raw offset
/// (disc[0..8] version[8] asset[9..41] mint_index[41..49]), pinned by
/// discriminator and version. Fixed-size fields only.
#[account]
pub struct VaultRecord {
    pub version: u8,
    pub asset: Pubkey,
    pub mint_index: u64,
    pub reveal_slot: u64,
    /// 0 = not yet drawn; 1..=5 = I..V.
    pub level: u8,
    pub charter: bool,
    pub entropy_set: bool,
    pub entropy: [u8; 32],
    /// sha256 of the Borsh attribute list written at mint, before the level.
    pub attrs_hash: [u8; 32],
    pub bump: u8,
    // ── v6 stage 3 (version 2), in what was padding ──
    /// On the payout schedule (set by `activate`, cleared by a retire).
    pub active: bool,
    /// Burned, by redemption or bare, and taken off the schedule. Permanent.
    pub retired: bool,
    /// How many times the capture window was missed and rescheduled.
    pub reschedules: u16,
    /// The vault's own cbBTC account, recorded at activation: the ONLY place a
    /// claim pays this vault.
    pub vault_ata: Pubkey,
    /// `weight * acc` already settled (at activation, and by every claim), scaled.
    pub debt_scaled: u128,
    // ── v6 stage 3c (version 3), in what was padding ──
    /// Activation requested, not yet joined (see `activate`).
    pub pending: bool,
    /// The distribution epoch the request was made in.
    pub request_epoch: u64,
    // ── the $CBOB boost (version 4), in what was padding ──
    /// Extra weight from a live boost (0 = none), and the epoch it ends at: it
    /// earns every distribution until `dist_epoch` reaches this, then is due.
    pub boost_weight: u8,
    pub boost_end_epoch: u64,
    /// A share earned and not yet paid, carried across a change of weight
    /// (scaled). What the vault is owed is always `weight * acc - debt + carry`;
    /// a weight change moves the owed share here and resets the debt, so a lower
    /// weight can never need a negative debt.
    pub carry_scaled: u128,
}

/// The only sweep change a vote may make: tighter. GOV carries it inside a
/// proposal and passes the same Borsh bytes through to `tighten_sweep`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct SweepTighten {
    pub sol_reserve_lamports: Option<u64>,
    pub max_sweep_lamports: Option<u64>,
    pub sweep_cooldown_secs: Option<i64>,
}

fn require_guardian(c: &MintConfig, signer: &Signer) -> Result<()> {
    require_keys_neq!(c.guardian, Pubkey::default(), MintError::NotTheGuardian);
    require_keys_eq!(signer.key(), c.guardian, MintError::NotTheGuardian);
    Ok(())
}

fn emit_wiring(c: &MintConfig) {
    emit!(WiringUpdated { collection: c.collection, governance: c.governance,
        pool: c.pool_ata, bank_treasury: c.bank_treasury, guardian: c.guardian,
        swap_operator: c.swap_operator, max_supply: c.max_supply, split_bps: c.split_bps,
        sales_stopped: c.sales_stopped, sweep_stopped: c.sweep_stopped });
}

/// A provenance pair stamped onto the vault at creation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VaultAttribute { pub key: String, pub value: String }

const MINT_CONFIG_SPACE: usize = 8 + 1 + 32 * 3 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 1
    + 32 + 32 + 8 + 1 + 8 + 8 + 8 + 4 * 5 + 4 * 5 + 8 + 32 + 32 + 32 + 8 + 8 + 4
    + 8 + 8 + 8 + 16 + 16 + 8
    + 8 + 8 + 32 + 8 + 8
    + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8
    + 32 + 1 + 2 + 8 + 1 + 2 + 4 + 4 + 8 + 8 + 4 * BOOST_RING + CONFIG_PADDING;
const VAULT_RECORD_SPACE: usize = 8 + 1 + 32 + 8 + 8 + 1 + 1 + 1 + 32 + 32 + 1
    + 1 + 1 + 2 + 32 + 16 + 1 + 8 + 1 + 8 + 16 + RECORD_PADDING;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = MINT_CONFIG_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: the CBOB Core collection; clean, ours, unminted — verified in-handler.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: PDA that signs as the collection's update authority.
    #[account(seeds = [MINT_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the SEAL program's config; it must already name this collection and
    /// carry the payment mint as a reserve (stage 3c) — verified in-handler.
    pub seal_config: UncheckedAccount<'info>,
    /// CHECK: THE $CBOB mint, pinned into the config; verified in-handler.
    pub cbob_mint: UncheckedAccount<'info>,
}

/// Every governance-only instruction. `governance` is the GOV program's ["gov"]
/// PDA, which signs by CPI from a ratified proposal and in no other way.
#[derive(Accounts)]
pub struct Governed<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = governance)]
    pub config: Account<'info, MintConfig>,
    pub governance: Signer<'info>,
}

#[derive(Accounts)]
pub struct ApplySwapOperator<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
}

#[derive(Accounts)]
pub struct Guardian<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    pub guardian: Signer<'info>,
}

#[derive(Accounts)]
pub struct SplitRevenue<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    /// CHECK: the ["revenue"] PDA, verified in-handler.
    #[account(mut)]
    pub revenue: UncheckedAccount<'info>,
    /// CHECK: the token being split.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: ATA of the revenue PDA, verified in-handler.
    #[account(mut)]
    pub revenue_ata: UncheckedAccount<'info>,
    /// CHECK: ATA of config.treasury (the holders' 85%), verified in-handler.
    #[account(mut)]
    pub holders_ata: UncheckedAccount<'info>,
    /// CHECK: ATA of config.bank_treasury (the 15%), verified in-handler.
    #[account(mut)]
    pub bank_ata: UncheckedAccount<'info>,
    /// CHECK: SPL Token.
    #[account(address = SPL_TOKEN_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SweepSolForSwap<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    /// CHECK: the ["revenue"] PDA, verified in-handler.
    #[account(mut)]
    pub revenue: UncheckedAccount<'info>,
    #[account(mut)]
    pub swap_operator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintVault<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(init, payer = payer, space = VAULT_RECORD_SPACE, seeds = [VAULT_SEED, asset.key().as_ref()], bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: new Core asset; Core initialises it.
    #[account(mut)]
    pub asset: Signer<'info>,
    /// CHECK: must equal config.collection; its update authority must be mint_authority.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// The member who will own the vault — and who MUST SIGN. A vault owned by an
    /// address that cannot sign a TOP-LEVEL instruction can never be redeemed
    /// (the pairing needs two top-level owner signatures). `is_signer` is true for
    /// a PDA passed as a CPI signer, so this is the best available check, not a
    /// complete one; `unredeemable_owner` in the alarm covers the rest.
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the payer's token account for the payment mint; SPL Token checks
    /// that `payer` is its authority.
    #[account(mut)]
    pub payer_token: UncheckedAccount<'info>,
    /// CHECK: must equal config.payment_mint, owned by SPL Token, verified in-handler.
    pub payment_mint: UncheckedAccount<'info>,
    /// CHECK: the revenue PDA's ATA for the payment mint, verified in-handler.
    #[account(mut)]
    pub revenue_token: UncheckedAccount<'info>,
    /// CHECK: SPL Token.
    #[account(address = SPL_TOKEN_ID)]
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: the SEAL program's config — canonical wiring, verified in-handler.
    pub seal_config: UncheckedAccount<'info>,
    /// CHECK: PDA that signs as the collection's update authority.
    #[account(seeds = [MINT_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the pool (config.pool_ata), read for the monthly in-line run.
    pub pool_token: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimCharterVault<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(init, payer = payer, space = VAULT_RECORD_SPACE, seeds = [VAULT_SEED, asset.key().as_ref()], bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: new Core asset; Core initialises it.
    #[account(mut)]
    pub asset: Signer<'info>,
    /// CHECK: must equal config.collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// Owns the Proof of Burn, and will own the vault.
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the Proof of Burn being spent; Core asset in config.pob_collection,
    /// owned by `owner`, a leaf of config.pob_root — verified in-handler.
    #[account(mut)]
    pub pob_asset: UncheckedAccount<'info>,
    /// CHECK: must equal config.pob_collection.
    #[account(mut)]
    pub pob_collection: UncheckedAccount<'info>,
    /// CHECK: the SEAL program's config — canonical wiring, verified in-handler.
    pub seal_config: UncheckedAccount<'info>,
    /// CHECK: PDA that signs as the collection's update authority.
    #[account(seeds = [MINT_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the pool (config.pool_ata), read for the monthly in-line run.
    pub pool_token: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CaptureEntropy<'info> {
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: pinned to the SlotHashes sysvar id inside `blockhash_in_window`.
    /// UncheckedAccount because SlotHashes is too large for `Sysvar<'info, _>`.
    pub slot_hashes: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RevealLevel<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: must equal vault_record.asset; a live AssetV1 or a burned one.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: must equal config.collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// Pays Core for the few bytes the level adds. Anyone.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA that holds the Attributes plugin authority.
    #[account(seeds = [MINT_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: pinned in-handler.
    pub slot_hashes: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RescheduleReveal<'info> {
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
}

#[derive(Accounts)]
pub struct Activate<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: must equal vault_record.asset and be a live vault in our collection.
    pub asset: UncheckedAccount<'info>,
    /// CHECK: the vault's canonical cbBTC ATA, derived and read in-handler.
    pub vault_token: UncheckedAccount<'info>,
    /// CHECK: the pool (config.pool_ata), read for the monthly in-line run.
    pub pool_token: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct BoostVault<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: must equal vault_record.asset and be a live vault in our collection.
    pub asset: UncheckedAccount<'info>,
    pub burner: Signer<'info>,
    /// CHECK: the burner's own $CBOB account; read in-handler, burned from by CPI.
    #[account(mut)]
    pub burner_token: UncheckedAccount<'info>,
    /// CHECK: must equal config.cbob_mint and be classic SPL; checked in-handler.
    #[account(mut)]
    pub cbob_mint: UncheckedAccount<'info>,
    /// CHECK: the classic SPL Token program.
    #[account(address = SPL_TOKEN_ID)]
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: the pool (config.pool_ata), read for the monthly in-line run.
    pub pool_token: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ExpireBoosts<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
}

#[derive(Accounts)]
pub struct Distribute<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    /// CHECK: must equal config.pool_ata; read in-handler.
    pub pool_token: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    /// Also the pool's token authority: it signs every payout by seeds.
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    /// CHECK: must equal config.pool_ata.
    #[account(mut)]
    pub pool_token: UncheckedAccount<'info>,
    /// CHECK: SPL Token.
    #[account(address = SPL_TOKEN_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RetireRedeemed<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: the vault being burned; must equal vault_record.asset and be burned.
    pub asset: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar — proves the caller is BURN's burn_vault.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    /// CHECK: the pool (config.pool_ata), read for the monthly in-line run.
    pub pool_token: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RetireBurned<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MintConfig>,
    #[account(mut, seeds = [VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
    pub vault_record: Account<'info, VaultRecord>,
    /// CHECK: must equal vault_record.asset and be POSITIVELY burned.
    pub asset: UncheckedAccount<'info>,
}

#[event] pub struct WiringUpdated { pub collection: Pubkey, pub governance: Pubkey, pub pool: Pubkey, pub bank_treasury: Pubkey, pub guardian: Pubkey, pub swap_operator: Pubkey, pub max_supply: u64, pub split_bps: u16, pub sales_stopped: bool, pub sweep_stopped: bool }
/// Every change to either stop, with who made it: the guardian can only ever set
/// them, so `by_guardian = true` with a flag going FALSE would be a defect.
#[event] pub struct SweepTightened { pub sol_reserve_lamports: u64, pub max_sweep_lamports: u64, pub sweep_cooldown_secs: i64 }
#[event] pub struct SwapOperatorArmed { pub operator: Pubkey, pub applies_after: i64 }
#[event] pub struct SwapOperatorCancelled { pub operator: Pubkey }
#[event] pub struct GuardianArmed { pub guardian: Option<Pubkey>, pub applies_after: i64 }
#[event] pub struct ActivationRequested { pub asset: Pubkey, pub level: u8, pub balance: u64, pub request_epoch: u64 }
#[event] pub struct StopChanged { pub sales_stopped: bool, pub sweep_stopped: bool, pub by_guardian: bool }
#[event] pub struct RoyaltiesFixed { pub basis_points: u16, pub revenue: Pubkey }
#[event] pub struct RevenueSplit { pub mint: Pubkey, pub total: u64, pub holders: u64, pub bank: u64, pub split_bps: u16 }
#[event] pub struct SolSweptForSwap { pub amount: u64, pub operator: Pubkey, pub remaining: u64 }
#[event] pub struct RoundSet { pub round_id: u32, pub opens_at: i64, pub closes_at: i64, pub price: u64, pub cap: u32 }
#[event] pub struct VaultMinted { pub asset: Pubkey, pub owner: Pubkey, pub round_id: u32, pub price: u64, pub mint_index: u64, pub charter: bool }
#[event] pub struct CharterClaimed { pub asset: Pubkey, pub owner: Pubkey, pub proof_of_burn: Pubkey, pub mint_index: u64 }
#[event] pub struct LevelRevealed { pub asset: Pubkey, pub mint_index: u64, pub level: u8, pub burned: bool }
#[event] pub struct RevealRescheduled { pub asset: Pubkey, pub mint_index: u64, pub old_reveal_slot: u64, pub new_reveal_slot: u64, pub reschedules: u16 }
#[event] pub struct VaultActivated { pub asset: Pubkey, pub level: u8, pub weight: u64, pub total_weight: u64, pub active_count: u64, pub epoch: u64 }
#[event] pub struct Distributed { pub amount: u64, pub total_weight: u64, pub active_count: u64, pub acc_scaled: u128, pub burned_gary: bool }
#[event] pub struct Claimed { pub vaults_paid: u32, pub vaults_deferred: u32, pub vaults_joined: u32, pub paid: u64 }
#[event] pub struct ClaimDeferred { pub asset: Pubkey, pub owed: u64 }
#[event] pub struct Boosted { pub asset: Pubkey, pub burner: Pubkey, pub burned: u64, pub extra_weight: u8, pub end_epoch: u64, pub total_weight: u64 }
#[event] pub struct BoostExpired { pub asset: Pubkey, pub extra_weight: u8, pub epoch: u64, pub total_weight: u64 }
#[event] pub struct BoostTermsSet { pub price: u64, pub weight: u8, pub epochs: u16 }
#[event] pub struct VaultRetired { pub asset: Pubkey, pub redeemed: bool, pub returned_to_pool_sats: u64, pub total_weight: u64, pub bare_burns_retired: u64 }

#[error_code]
pub enum MintError {
    #[msg("only the designated init authority may initialize")] NotTheInitAuthority,
    #[msg("this restart was voted before the stop it would lift; vote again")] StopIsNewer,
    #[msg("no swap operator is pending")] NoPendingOperator,
    #[msg("the swap operator's notice period has not elapsed")] OperatorNoticeNotElapsed,
    #[msg("wrong collection")] WrongCollection,
    #[msg("wrong treasury")] WrongTreasury,
    #[msg("no round has been ratified yet")] NoRound,
    #[msg("the round is not open")] RoundClosed,
    #[msg("this round's cap is reached")] RoundCapReached,
    #[msg("closes_at must be after opens_at")] BadWindow,
    #[msg("vault name too long")] NameTooLong,
    #[msg("vault uri too long")] UriTooLong,
    #[msg("numeric overflow")] Overflow,
    #[msg("seal_config account is not the seal program's config")] BadSealConfig,
    #[msg("mint wiring has diverged from the seal program's config")] WiringDiverged,
    #[msg("max_supply must be non-zero")] BadSupplyCap,
    #[msg("the lifetime vault supply cap has been reached")] SupplyCapReached,
    #[msg("a round cap of zero is not an unlimited round; give a real cap")] BadCap,
    #[msg("too many attributes, or an attribute string is too long")] TooManyAttributes,
    #[msg("the `redemption`, `level` and `charter` attributes belong to the programs and may not be set by a caller")] ReservedAttribute,
    #[msg("two attributes share a key; a map a reader takes money decisions from may not have two answers")] DuplicateAttribute,
    #[msg("the SlotHashes sysvar account is not the sysvar, or is malformed")] BadSlotHashes,
    #[msg("every level's quota is drawn; the census is a hard on-chain ceiling")] LevelCapReached,
    #[msg("the level caps must each be non-zero and must not sum above max_supply")] BadLevelCaps,
    #[msg("the seal config is a layout version this program was not compiled against")] SealConfigVersion,
    #[msg("the round price is above the maximum this payer agreed to")] PriceAboveMax,
    #[msg("a voted round may not be priced below 21,000 sats")] PriceBelowFloor,
    #[msg("sales are stopped by the guardian; only a governance vote can restart them")] SalesStopped,
    #[msg("the SOL sweep is stopped by the guardian; only a governance vote can restart it")] SweepStopped,
    #[msg("only the guardian may stop sales or the sweep, and a retired guardian is nobody")] NotTheGuardian,
    #[msg("this instruction would change nothing")] NothingToDo,
    #[msg("there is nothing in the revenue address to split")] NothingToSplit,
    #[msg("sweep bounds out of range: cap non-zero, cooldown 1s to 7 days, SOL reserve zero or above rent exemption")] BadSweepBound,
    #[msg("this sweep is larger than the per-sweep cap in config")] SweepAboveCap,
    #[msg("the sweep cooldown has not elapsed since the last sweep")] SweepTooSoon,
    #[msg("this sweep would breach the SOL reserve the revenue address keeps for fees")] ReserveWouldBreach,
    #[msg("the payment mint is not config.payment_mint, or not a classic SPL mint")] WrongPaymentMint,
    #[msg("the collection's update authority is not this program's PDA")] CollectionNotOurs,
    #[msg("the collection already carries a plugin or has minted; it must arrive clean")] CollectionNotClean,
    #[msg("the charter window must close after it opens, last at most 90 days, and not already be over")] BadCharterWindow,
    #[msg("the Proof of Burn root and collection must be set")] BadPobRoot,
    #[msg("the charter window has not opened")] CharterNotOpen,
    #[msg("the charter window has closed, and it can never reopen")] CharterClosed,
    #[msg("that account is not a live Proof of Burn asset in the Proof of Burn collection")] NotAProofOfBurn,
    #[msg("the signer does not own that Proof of Burn")] NotThePobOwner,
    #[msg("that asset is not one of the committed Proof of Burn set")] NotInPobSet,
    #[msg("the Proof of Burn proof is longer than any tree this set can produce")] PobProofTooLong,
    #[msg("this vault's entropy is already captured or its level already drawn")] AlreadyCaptured,
    #[msg("this vault's reveal slot has not been produced yet; wait a few seconds")] RevealTooEarly,
    #[msg("this vault's capture window has passed; call reschedule_reveal")] RevealWindowExpired,
    #[msg("this vault's level is already drawn")] AlreadyRevealed,
    #[msg("levels are drawn strictly in mint order; reveal the earlier vault first")] RevealOutOfOrder,
    #[msg("the asset is not this record's vault")] WrongAsset,
    #[msg("the attributes do not match what this vault was minted with")] AttributesMismatch,
    #[msg("this vault's capture window passed with no entropy; call reschedule_reveal (no level is ever assigned without entropy)")] NeedsReschedule,
    #[msg("the capture window has not passed; capture the entropy instead")] RescheduleTooEarly,
    #[msg("at most MAX_CRANK queued records may ride on one instruction")] TooManyCranked,
    #[msg("this vault was burned and is off the payout schedule for good")] VaultRetired,
    #[msg("this vault is already activated")] AlreadyActive,
    #[msg("this vault's level has not been drawn yet")] NotRevealed,
    #[msg("a vault activates at 21,000 sats in its own cbBTC account")] BelowActivation,
    #[msg("that is not this vault's cbBTC account")] WrongVaultAccount,
    #[msg("the vault's cbBTC account is missing or not a token account; a claim never creates one")] VaultAccountMissing,
    #[msg("that is not the community pool")] WrongPool,
    #[msg("no vault is activated; there is nobody to distribute to")] NoActiveVaults,
    #[msg("the pool holds nothing undistributed")] NothingToDistribute,
    #[msg("a distribution needs 100 $GARY burned, or 30 days since the last one")] MonthNotElapsed,
    #[msg("the distribute burn accounts are malformed")] BadBurnAccounts,
    #[msg("that is not the $GARY mint (classic SPL, pinned by address)")] WrongGaryMint,
    #[msg("the burner's $GARY account holds less than 100 $GARY")] InsufficientGary,
    #[msg("the distribution period must be between 60 seconds and 30 days")] BadMonthlyPeriod,
    #[msg("the pool holds less than it owes; refusing to distribute")] PoolShort,
    #[msg("claim takes [SlotHashes, records...] when cranking, then (record, cbBTC account) pairs")] BadClaimList,
    #[msg("this vault is still owed at least 1 sat; put `claim` before the sweep in the redemption")] ClaimBeforeBurn,
    #[msg("retire_redeemed may only be called by BURN, from inside burn_vault for this vault")] NotFromBurn,
    #[msg("the asset is not positively burned (Core-owned, one byte, Key::Uninitialized)")] NotBurned,
    #[msg("this vault is already retired")] AlreadyRetired,
    #[msg("that account is not a vault record of this program")] BadVaultRecord,
    #[msg("the asset is not a live vault in the CBOB collection")] NotALiveVault,
    #[msg("the attribute list is larger than a legacy reveal transaction can re-send")] AttributesTooLarge,
    // ── stage 3c ──
    #[msg("the notice period must be between 60 seconds and 30 days")] BadNotice,
    #[msg("the payment mint must be one of the SEAL program's reserve mints")] PaymentMintNotAReserve,
    #[msg("a vote may not tighten the sweep past the bounds fixed at initialize")] TightenOutOfBounds,
    #[msg("no guardian change is pending")] NoPendingGuardian,
    #[msg("the guardian's notice period has not elapsed")] GuardianNoticeNotElapsed,
    #[msg("this vault has requested activation and joins only after the next distribution")] ActivationPending,
    #[msg("pob_extra exceeds the pass-through bound or the accounts supplied")] BadPobExtra,
    #[msg("vaults that asked to activate before the last distribution must be joined first (claim them; it is free)")] JoinWaitingFirst,
    #[msg("boosts are off until a Governor vote sets their terms")] BoostsOff,
    #[msg("only an activated vault can be boosted")] BoostNeedsActiveVault,
    #[msg("this vault already carries a boost")] BoostActive,
    #[msg("not THE $CBOB mint, or not classic SPL")] WrongCbobMint,
    #[msg("the burner's $CBOB account does not hold the boost price")] InsufficientCbob,
    #[msg("boost terms outside the bounds fixed at initialize")] BoostTermsOutOfBounds,
    #[msg("this boost has not had all its distributions yet")] BoostNotDue,
    #[msg("a boost whose distributions are over must be expired first (claim it; it is free)")] BoostsExpireFirst,
    #[msg("bad $CBOB mint or boost bounds at initialize")] BadBoostSetup,
    #[msg("only the vault's current owner may boost it")] BoostNotTheOwner,
    #[msg("the boost terms changed after you signed; nothing was burned")] BoostTermsMoved,
}

/// HOST UNIT TESTS (round 23, F9 and F7e): what a local validator can never show.
/// A test validator skips no slots, so the skipped-slot paths of the entropy
/// reader were never exercised; and the suite cannot cheaply drive 64+
/// distributions, so the boost ring's wrap was never exercised. These build the
/// sysvar bytes and the config by hand and check against independent models.
/// `cargo test -p cbob-vault-mint --features localnet --lib`
#[cfg(test)]
mod host_tests {
    use super::*;
    use anchor_lang::solana_program::sysvar::slot_hashes;

    /// SlotHashes bytes: u64 count, then (slot, hash) newest first, as the sysvar is.
    fn sysvar_bytes(slots: &[u64]) -> Vec<u8> {
        let mut v: Vec<u64> = slots.to_vec();
        v.sort_unstable_by(|a, b| b.cmp(a));
        let mut d = (v.len() as u64).to_le_bytes().to_vec();
        for s in v { d.extend_from_slice(&s.to_le_bytes()); d.extend_from_slice(&hash_of(s)); }
        d
    }
    fn hash_of(slot: u64) -> [u8; 32] { hashv(&[b"slot", &slot.to_le_bytes()]).to_bytes() }
    fn with_sysvar<R>(data: &mut [u8], key: &Pubkey, f: impl FnOnce(&AccountInfo) -> R) -> R {
        let mut lamports = 1u64;
        let owner = Pubkey::default();
        let ai = AccountInfo::new(key, false, false, &mut lamports, data, &owner, false, 0);
        f(&ai)
    }
    fn lookup(slots: &[u64], want: u64) -> Option<u64> {
        let mut d = sysvar_bytes(slots);
        with_sysvar(&mut d, &slot_hashes::ID, |a| blockhash_in_window(a, want).unwrap().map(|(h, s)| { assert_eq!(h, hash_of(s)); s }))
    }

    #[test]
    fn the_lookup_takes_the_smallest_produced_slot_in_the_window() {
        let produced: Vec<u64> = (1000..1200).filter(|s| s % 7 != 0).collect(); // skips every 7th
        // Multiples of 7 are skipped: 1001, 1008, 1015, ...
        assert_eq!(lookup(&produced, 1003), Some(1003), "present: itself");
        assert_eq!(lookup(&produced, 1008), Some(1009), "1008 skipped: the next produced");
        assert_eq!(lookup(&produced, 1001), Some(1002), "1001 skipped: the next produced");
        // A run of skips right at the target, and the smallest produced after it wins.
        let gappy: Vec<u64> = (1000..1200).filter(|s| !(1050..1060).contains(s)).collect();
        assert_eq!(lookup(&gappy, 1050), Some(1060));
        // Nothing produced inside [want, want + MAX_SKIPPED_SLOTS]: None, never a later slot.
        // The window is [want, want + MAX_SKIPPED_SLOTS] INCLUSIVE: one past it is out,
        // the last slot in it is in.
        assert_eq!(lookup(&[1000, 1001 + MAX_SKIPPED_SLOTS + 1], 1001), None);
        assert_eq!(lookup(&[1000, 1001 + MAX_SKIPPED_SLOTS], 1001), Some(1001 + MAX_SKIPPED_SLOTS));
        // The target is newer than anything in the buffer: not yet.
        assert_eq!(lookup(&produced, 5000), None);
        // An older slot below the target never qualifies.
        assert_eq!(lookup(&[900, 1100], 1000), None);
    }

    #[test]
    fn a_full_buffer_reads_and_malformed_ones_are_refused() {
        let full: Vec<u64> = (10_000..10_000 + SLOT_HASHES_MAX as u64).collect();
        assert_eq!(lookup(&full, 10_000), Some(10_000), "the oldest of 512");
        assert_eq!(lookup(&full, 10_511), Some(10_511), "the newest of 512");
        // 513 declared: refused.
        let mut over = sysvar_bytes(&(0..SLOT_HASHES_MAX as u64 + 1).collect::<Vec<_>>());
        assert!(with_sysvar(&mut over, &slot_hashes::ID, |a| blockhash_in_window(a, 0).is_err()));
        // Truncated: refused, never zero-filled.
        let mut short = sysvar_bytes(&[5, 6, 7]); short.truncate(8 + 40 * 2);
        assert!(with_sysvar(&mut short, &slot_hashes::ID, |a| blockhash_in_window(a, 5).is_err()));
        // A forged account under another key: refused.
        let mut d = sysvar_bytes(&[5]);
        assert!(with_sysvar(&mut d, &Pubkey::new_unique(), |a| blockhash_in_window(a, 5).is_err()));
        // An all-zero hash for a qualifying slot: refused, not fed into a draw.
        let mut z = sysvar_bytes(&[5]); for b in &mut z[16..48] { *b = 0; }
        assert!(with_sysvar(&mut z, &slot_hashes::ID, |a| blockhash_in_window(a, 5).is_err()));
    }

    /// The independent model of `try_capture`: A, then B and C each
    /// ENTROPY_GROUP_STRIDE leader groups after the previous hash's group.
    fn model(produced: &[u64], reveal: u64) -> Option<(u64, u64, u64)> {
        let next = |w: u64| produced.iter().copied().filter(|s| *s >= w && *s <= w + MAX_SKIPPED_SLOTS).min();
        let a = next(reveal)?;
        let b = next((a / LEADER_GROUP_SLOTS + ENTROPY_GROUP_STRIDE) * LEADER_GROUP_SLOTS)?;
        let c = next((b / LEADER_GROUP_SLOTS + ENTROPY_GROUP_STRIDE) * LEADER_GROUP_SLOTS)?;
        Some((a, b, c))
    }

    #[test]
    fn capture_skips_at_a_b_and_c_and_matches_the_model() {
        let asset = Pubkey::new_unique();
        let reveal = 2000u64;
        // Skips placed exactly on each target (A at 2000, B's group start, C's).
        for skips in [vec![2000u64], vec![2008, 2009], vec![2016, 2017, 2018], vec![2000, 2008, 2016], vec![]] {
            let produced: Vec<u64> = (1900..2200).filter(|s| !skips.contains(s)).collect();
            let (a, b, c) = model(&produced, reveal).expect("the model finds three");
            assert!(b / LEADER_GROUP_SLOTS >= a / LEADER_GROUP_SLOTS + ENTROPY_GROUP_STRIDE);
            assert!(c / LEADER_GROUP_SLOTS >= b / LEADER_GROUP_SLOTS + ENTROPY_GROUP_STRIDE);
            let mut d = sysvar_bytes(&produced);
            let got = with_sysvar(&mut d, &slot_hashes::ID, |sh| try_capture(sh, reveal, 2199, &asset).unwrap());
            let want = hashv(&[&hash_of(a), &hash_of(b), &hash_of(c), asset.as_ref()]).to_bytes();
            match got { Capture::Got(e) => assert_eq!(e, want, "skips {:?}", skips), _ => panic!("expected Got for skips {:?}", skips) }
        }
        // C not produced yet: NotYet, never a partial draw.
        let produced: Vec<u64> = (1900..2010).collect();
        let mut d = sysvar_bytes(&produced);
        assert!(matches!(with_sysvar(&mut d, &slot_hashes::ID, |sh| try_capture(sh, reveal, 2009, &asset).unwrap()), Capture::NotYet));
        // At or before the reveal slot: NotYet. Past the window: Expired.
        let mut d = sysvar_bytes(&(1900..2200).collect::<Vec<_>>());
        assert!(matches!(with_sysvar(&mut d, &slot_hashes::ID, |sh| try_capture(sh, reveal, reveal, &asset).unwrap()), Capture::NotYet));
        assert!(matches!(with_sysvar(&mut d, &slot_hashes::ID, |sh| try_capture(sh, reveal, reveal + REVEAL_WINDOW_SLOTS + 1, &asset).unwrap()), Capture::Expired));
    }

    fn blank_config() -> MintConfig {
        let zeros = vec![0u8; MINT_CONFIG_SPACE];
        MintConfig::deserialize(&mut &zeros[8..]).expect("a zeroed MintConfig deserializes")
    }

    #[test]
    fn the_boost_ring_wraps_exactly_against_a_model() {
        let mut c = blank_config();
        let mut live: Vec<u64> = Vec::new(); // end epochs of live boosts (the model)
        let mut due_model = 0u32;
        let mut seed = 0x2545F4914F6CDD1Du64;
        let mut rnd = || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; seed };
        for _ in 0..1000 {
            // Buy 0..3 boosts this epoch, each lasting 1..=MAX_BOOST_EPOCHS_BOUND.
            for _ in 0..(rnd() % 4) {
                let n = 1 + rnd() % MAX_BOOST_EPOCHS_BOUND as u64;
                let end = c.dist_epoch + n;
                let i = (end % BOOST_RING as u64) as usize;
                c.boost_expiring[i] += 1; c.boosts_active += 1;
                live.push(end);
            }
            // Expire every due one some of the time (the gate requires all before the next).
            if rnd() % 2 == 0 {
                live.retain(|e| *e > c.dist_epoch);
                c.boosts_active -= c.boosts_due; c.boosts_due = 0; due_model = 0;
            }
            if c.boosts_due != 0 { continue; } // a distribution is refused while any is due
            advance_epoch(&mut c).unwrap();
            due_model += live.iter().filter(|e| **e == c.dist_epoch).count() as u32;
            assert_eq!(c.boosts_due, due_model, "epoch {}", c.dist_epoch);
            let sched: u32 = c.boost_expiring.iter().sum();
            assert_eq!(sched + c.boosts_due, c.boosts_active, "ring + due = active at epoch {}", c.dist_epoch);
        }
        assert!(c.dist_epoch > 3 * BOOST_RING as u64, "the ring wrapped several times ({} epochs)", c.dist_epoch);
    }

    /// ROUND 25 (N1): the boost schedule driven through the PROGRAM'S OWN free
    /// functions over 260 epochs (four wraps), against a model rebuilt from the
    /// records alone. Joins are `join`, a boost's weight is `reweigh`, an early
    /// (not-yet-due) and a due retirement are `retire` (so both branches of
    /// `unschedule_boost`), an expiry is `expire_boost`, and every distribution
    /// is `credit` or `tick` (so `advance_epoch`). The ONE thing written by hand
    /// is the purchase's ring slot, because `boost_vault` schedules it inline in
    /// the handler (MINT:1509-1511) and no free function exists to call: those
    /// three lines are copied verbatim below, and every slot of the ring is then
    /// checked, per index, against the records.
    fn fresh_record(c: &mut MintConfig, level: u8) -> VaultRecord {
        // What `activate`'s first call leaves (MINT:1436-1442): requested, waiting.
        c.pending_count += 1; c.pending_this_epoch += 1;
        VaultRecord { version: VAULT_RECORD_VERSION, asset: Pubkey::new_unique(), mint_index: 0, reveal_slot: 0, level,
            charter: false, entropy_set: true, entropy: [0; 32], attrs_hash: [0; 32], bump: 0, active: false,
            retired: false, reschedules: 0, vault_ata: Pubkey::default(), debt_scaled: 0, pending: true,
            request_epoch: c.dist_epoch, boost_weight: 0, boost_end_epoch: 0, carry_scaled: 0 }
    }

    #[test]
    fn the_boost_schedule_through_the_programs_own_functions_across_four_wraps() {
        let ring = BOOST_RING as u64;
        let n_max = MAX_BOOST_EPOCHS_BOUND as u64;
        assert_eq!(n_max, 63, "N = 63 is the bound this test is about");
        let mut c = blank_config();
        let mut recs: Vec<VaultRecord> = (0..48u8).map(|i| fresh_record(&mut c, 1 + i % 5)).collect();
        let mut seed = 0x9E37_79B9_7F4A_7C15u64;
        let mut rnd = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; seed };
        let (mut buys, mut buys63, mut wrapped_buys) = (0u32, 0u32, 0u32);
        let (mut early, mut early_wrapped, mut early_wrapped63, mut due_retired, mut expired) = (0u32, 0u32, 0u32, 0u32, 0u32);
        for step in 0..260i64 {
            // THE GATE before any distribution: every eligible request joined...
            for r in recs.iter_mut() {
                if r.pending && c.dist_epoch > r.request_epoch { join(&mut c, r).unwrap(); }
            }
            assert_eq!(waiting_to_join(&c).unwrap(), 0);
            // BUY: `boost_vault`'s scheduling (inline in the handler, copied), then `reweigh`.
            for r in recs.iter_mut() {
                if !r.active || r.retired || r.boost_weight != 0 || rnd() % 3 != 0 { continue; }
                let extra = 1 + (rnd() % MAX_BOOST_WEIGHT_BOUND as u64) as u8;
                let epochs = if rnd() % 2 == 0 { n_max } else { 1 + rnd() % n_max };
                let end = c.dist_epoch.checked_add(epochs).unwrap();
                let i = (end % BOOST_RING as u64) as usize;
                c.boost_expiring[i] = c.boost_expiring[i].checked_add(1).unwrap();
                c.boosts_active = c.boosts_active.checked_add(1).unwrap();
                c.boost_weight_total = c.boost_weight_total.checked_add(extra as u64).unwrap();
                reweigh(&mut c, r, extra).unwrap();
                r.boost_end_epoch = end;
                buys += 1; if epochs == n_max { buys63 += 1; }
                if end % ring < c.dist_epoch % ring { wrapped_buys += 1; }
            }
            // EARLY RETIREMENT (a bare burn of a boosted vault BEFORE it is due):
            // `retire` -> `unschedule_boost`'s not-due branch, at the purchase's slot.
            for r in recs.iter_mut() {
                if !r.active || r.retired || r.boost_weight == 0 || c.dist_epoch >= r.boost_end_epoch || rnd() % 14 != 0 { continue; }
                let wrapped = r.boost_end_epoch % ring < c.dist_epoch % ring;
                if wrapped { early_wrapped += 1; if r.boost_end_epoch == c.dist_epoch + n_max { early_wrapped63 += 1; } }
                let slot = (r.boost_end_epoch % ring) as usize; let before = c.boost_expiring[slot];
                retire(&mut c, r, false, false).unwrap();
                assert_eq!(c.boost_expiring[slot], before - 1, "the early retire freed exactly its own slot {}", slot);
                early += 1;
            }
            // ...and every DUE boost cleared: expired, or its vault retired (the due branch).
            for r in recs.iter_mut() {
                if !r.active || r.retired || r.boost_weight == 0 || c.dist_epoch < r.boost_end_epoch { continue; }
                if rnd() % 3 == 0 { retire(&mut c, r, false, false).unwrap(); due_retired += 1; }
                else { expire_boost(&mut c, r).unwrap(); expired += 1; }
            }
            assert_eq!(c.boosts_due, 0, "the gate: nothing due before a distribution");
            // A retired vault is replaced by a new request, so the schedule never empties.
            let n_retired = recs.iter().filter(|r| r.retired).count();
            recs.retain(|r| !r.retired);
            for k in 0..n_retired { let lv = 1 + (k % 5) as u8; let r = fresh_record(&mut c, lv); recs.push(r); }
            // THE DISTRIBUTION: `credit` (which calls `advance_epoch`), or `tick` with nobody joined.
            if c.total_active_weight > 0 {
                let avail = 1 + rnd() % 1_000_000;
                let w = c.total_active_weight;
                credit(&mut c, avail, w, step).unwrap();
            } else { tick(&mut c, step).unwrap(); }
            // THE MODEL, from the records alone.
            let live: Vec<&VaultRecord> = recs.iter().filter(|r| r.active && !r.retired).collect();
            let boosted: Vec<&&VaultRecord> = live.iter().filter(|r| r.boost_weight > 0).collect();
            let due = boosted.iter().filter(|r| r.boost_end_epoch <= c.dist_epoch).count() as u32;
            assert!(boosted.iter().all(|r| r.boost_end_epoch >= c.dist_epoch), "no boost ran past its end (epoch {})", c.dist_epoch);
            assert_eq!(c.boosts_due, due, "due at epoch {}", c.dist_epoch);
            assert_eq!(c.boosts_active, boosted.len() as u32, "active at epoch {}", c.dist_epoch);
            assert_eq!(c.boost_weight_total, boosted.iter().map(|r| r.boost_weight as u64).sum::<u64>());
            for i in 0..BOOST_RING {
                let want = boosted.iter().filter(|r| r.boost_end_epoch > c.dist_epoch && (r.boost_end_epoch % ring) as usize == i).count() as u32;
                assert_eq!(c.boost_expiring[i], want, "ring slot {} at epoch {}", i, c.dist_epoch);
            }
            assert_eq!(c.total_active_weight, live.iter().map(|r| weight_of(r).unwrap()).sum::<u64>());
            let owed: u128 = live.iter().map(|r| owed_of(r, c.acc_scaled).unwrap()).sum();
            assert_eq!(c.owed_scaled, owed, "every vault's share is owed exactly once at epoch {}", c.dist_epoch);
        }
        assert_eq!(c.dist_epoch, 260, "260 distributions, {} wraps of the ring", 260 / ring);
        // COVERAGE, so this cannot pass by never reaching the branch it exists for.
        assert!(buys > 500 && buys63 > 200 && wrapped_buys > 100, "buys {} (N=63: {}), wrapped {}", buys, buys63, wrapped_buys);
        assert!(early > 50 && early_wrapped > 20 && early_wrapped63 > 3, "early {} wrapped {} (N=63 same epoch: {})", early, early_wrapped, early_wrapped63);
        assert!(due_retired > 15 && expired > 50, "due retires {}, expiries {}", due_retired, expired);
        println!("N1 coverage: buys {} (N=63 {}, wrapped {}); early {} (wrapped {}, N=63 same epoch {}); due retired {}; expired {}",
            buys, buys63, wrapped_buys, early, early_wrapped, early_wrapped63, due_retired, expired);
    }
}
