# CBOB Vaults v6: the program is the second signer

**Status: decided by Gary 2026-10-03; BUILT on branch `v6` through stage 3c and every audit round since (the $CBOB boost, SPEC 51; the sweep helper, round 24; `rescue_nested`, round 35, SPEC 58)**
(`git log`). The freeze counter is at zero (see `audits/FREEZE.md`), deliberately:
v6 is the version we will launch, so it is the version that must earn the two
clean rounds. Nothing is deployed except an inert placeholder at all five program ids (claimed on mainnet 2026-10-07; it refuses every instruction).

## Gary's rulings (2026-10-03), verbatim where it matters

1. *"The program should own the other signature."* There is no Bank key. The
   programs' own rules are the second party to every mint and every redemption.
2. *"The % that goes back to the community should live in the program."* The 85%
   stays in a program-owned pool. No distributor wallet, no key on our server.
3. *"I should not have to sign every transaction with my multi-sig."* The CBOBTC
   Squads `bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1` only RECEIVES the 15%. It
   signs nothing, ever.
4. **Gary's main wallet** `Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb`
   (Phantom; verified on mainnet 2026-10-03 as an on-curve system account) is the
   **GUARDIAN**, and its only power is the emergency stop (ruling 7). It also
   signs the one-time `initialize` (replaces the Squads as `INIT_AUTHORITY`).
5. **The programs are made IMMUTABLE at launch.** No upgrade authority exists
   after deploy. Nobody, including us, can change the rules.
6. *"The only way to freeze/enable sales is with a community vote."*
7. Refined the same day: *"my wallet keep the privileges to stop a sell in an
   emergency but that's all. It can't turn back on without a vote. But it CAN
   stop if there's an emergency."* And yes to a swap-bot stop. So: **the
   guardian can STOP, only a vote can RESTART, and the guardian has no other
   power.** There is no admin role in v6.

## Who signs what

| action | v5 (frozen) | **v6** |
|---|---|---|
| mint a vault | owner + Bank key | **owner** + program rules |
| level assignment | Bank-supplied deck proof | **program**, from a future slot hash (below) |
| open + sweep + burn | owner + Bank key | **owner** + program rules |
| split income 85/15 | anyone | anyone (unchanged) |
| pay the 85% | distributor key on our box | **program pool**; anyone cranks a vault's claim INTO that vault |
| SOL to cbBTC swap | swap operator key | swap operator key (the one key left, rate-limited on-chain) |
| STOP sales / stop the swap bot | admin, immediate | **guardian (Gary's wallet), immediate, one-way** |
| RESTART sales / the swap bot | admin, immediate | **governance vote only** |
| rounds, price, royalties, money wiring | governance (+admin) | **governance vote only** (there is no admin) |
| upgrade a program | upgrade authority | **impossible** (immutable) |

## 1. Mint without a Bank

### Who may mint
Anyone, during a governance-set round, paying the round price, owner signing.
The round's `cap`, window and the lifetime `max_supply` bound it exactly as today.

### The free charter round must be proven on-chain
v5 relied on a Bank duty: refuse a price-0 mint not backed by a burned Proof of
Burn. With no Bank, a price-0 round would let anyone mint free vaults up to the
cap. **v6: a charter mint CPI-burns exactly one Proof of Burn held by the
owner, in the same instruction.** 1 PoB = 1 free vault (Gary 2026-08-13), and the
burn is the coupon being spent. RESOLVED (was OPEN): a Proof of Burn is a
Metaplex Core asset in the Giraffish Moments collection, not an SPL token. The
240 addresses are listed in `scripts/pob-set.json` (checked against mainnet by
`scripts/probe-mainnet-facts.mjs`) and committed as the Merkle root `pob_root`, and the collection is pinned as `pob_collection`, both
fixed at `initialize` (SPEC, "ONE PROOF OF BURN, ONE VAULT, ONE WINDOW").

### Levels: random at mint, with no deck and no salt
v5's committed deck needed a party that knew the deck and kept it secret during
minting, which was the Bank, and that is exactly why the Bank controlled the
queue (accepted limit 24). With no Bank the deck would have to be public, and a
public deck lets a bot watch `minted_total` and snipe the Level V positions.

v6 replaces the deck with a **two-step reveal from a future slot hash**:

1. `mint_vault` creates the vault, takes payment, records `reveal_slot =
   current_slot + K`, and leaves the level unset. The minter has already paid,
   so they cannot abort a bad outcome.
2. `reveal_level(vault)`, **permissionless**, uses three slot hashes captured
   from the `SlotHashes` sysvar: A, the first PRODUCED slot at or after
   `reveal_slot` (round 21: slots get skipped), then B and C, each the first
   produced slot at least two 4-slot leader groups after the previous one. It
   computes `r = sha256(hA || hB || hC || asset)` and draws WITHOUT
   REPLACEMENT from the remaining census: `r mod sum(level_caps - level_minted)`
   walked across levels I..V. Exact quotas hold by construction.

Nobody knows the slot hash when they submit the mint, so simulation-and-retry is
useless. Our app and a crank reveal within seconds.

**A missed reveal is RESCHEDULED, never penalised** (Gary 2026-10-03: "We can't
lock everyone in the lowest level"; this replaces stage 2's expiry-to-lowest).
`SlotHashes` holds 512 slots; the capture window is 300 slots (~2 min), kept
well inside that so a capture in time always finds its slot. If nobody captures
a vault's entropy in that window, anyone may reschedule it to a fresh FUTURE slot, so the new hash is
unknown at the time of the call. Every mint, charter claim, activation and claim
captures entropy for ripe queued vaults, alongside our crank, so a lapse needs
nobody, crank or traffic, to capture inside the window (SPEC 25 says who can
cause one deliberately). Every reschedule is
alarmed. ⚠️ ACCEPTED LIMIT: a minter who has computed their lapsed draw can let
it lapse for one re-roll per window, only during such an outage. ⚠️ ACCEPTED
LIMIT (SPEC 26, corrected round 24): the leader of C's slot CHOOSES among many
draws, not two: it can skip its own first slot(s) to move C within its 4-slot
group (best-of-4 alone takes P(Level V) from 5.0% to 18.6%) and vary its block's
contents for more, for every vault minted in the same slot at once.

**What this deletes:** `commit_seed`, `commit_deck`, the deck root, the Merkle
proof in the mint transaction, `bank/deck.mjs`, the salt ceremony, accepted
limits 23 and 24, and the packet squeeze between the deck proof and provenance
attributes. All of rounds 20 and 21's worst findings lived there.

### No mint may vote on a proposal opened before it
v5 Bank duty (refuse to co-sign a mint during an open vote) and accepted limit 15.
v6: the vault's mint index is recorded in its MINT `VaultRecord` (where GOV reads
it), each proposal snapshots
`minted_total` at creation, and a vote from an index at or above the snapshot is
refused on-chain.

## 2. Redemption without a Bank

Unchanged in shape: `open_for_redemption` (SEAL) ... sweeps ... `burn_vault`
(BURN), one transaction, each half binding asset AND owner, the emptiness proof
untouched. Remove `bank: Signer` and the Bank checks from both programs.

**The sweep happens at execution (Gary 2026-10-05, round 24 A3).** A sweep of
amounts read before sending can be defeated by a stranger's dust landing in
between, indefinitely by one who keeps paying. The redeem page therefore sweeps
through a small stateless helper, `programs/cbob-vault-sweep`, called by the
owner through Core's `ExecuteV1`: at the moment it runs it moves each reserve
account's whole live balance to the owner, closes those accounts, and sends the
vault wallet's SOL to the owner, inside the same atomic redemption. It changes
none of the four programs; BURN's emptiness proof is unchanged. Deployed and
locked with them (SPEC item 50 and the round 23 F1 entry in "Known limits").

**What the Bank's pre-sign scan did, and where it goes:** it refused a redemption
that would destroy undeclared holdings (an airdropped token, a nested vault). The
chain still cannot list what a PDA holds, so this moves into **our redeem app**:
classic airdrops it can safely deliver go to the redeemer in the same transaction,
what it cannot move is named in a box the owner ticks before signing, and a nested
CBOB vault refuses the opening until it is rescued on chain (`rescue_nested`,
SPEC item 58, to the CBOBTC Squads). Who is protected: the redeemer, from
their own extra items. The three reserve tokens are checked ON-CHAIN regardless.

**Disappears with the Bank:** the Bank-as-fee-payer gap, "the Bank must be a
plain keypair", the 7-day halt on a lost Bank key, and the bank-pubkey
confinement (nothing to confine).

**Unchanged:** an off-curve owner (a DAO, a multisig) still cannot redeem;
a bare Core `BurnV1` by the owner still cannot be prevented (proven impossibility 1).

## 3. The community pool lives in the program

`split_revenue` sends the 85% to a **program-owned pool** instead of the
distributor wallet. Payout is a reward accumulator, the standard staking pattern:

- `activate(vault)`, **permissionless**: reads the vault's cbBTC ATA (owned by its
  asset-signer PDA). If it holds >= 21,000 sats and the level is revealed, it
  REQUESTS activation. The level weight (2/3/4/5/6) enters `total_active_weight`
  only when the vault JOINS, after the next distribution, at the accumulator as
  it then stands (`debt = weight * acc`; see "An activation joins at the NEXT
  distribution" below).
- **Why this cannot be gamed by funding a vault for a moment:** a sealed vault's
  contents cannot leave except by redemption, and redemption burns the vault. A
  balance can only go UP. Activation is therefore permanent for the vault's life,
  which is precisely the property v5 said made an activation instruction unsafe
  (it would have put the Bank between funding and being paid; here nobody
  stands there, anyone can call it).
- `distribute()`, **permissionless**, moves the pool into the accumulator:
  `acc += amount * 1e12 / total_active_weight`. What may trigger it is section 9
  (a 100 $GARY burn, or 30 days). Dust stays in the pool and carries.
- **An activation joins at the NEXT distribution** (stage 3c, red-team 2 finding
  5). `activate` first REQUESTS; the vault joins the schedule (and its weight
  enters the denominator) only once a distribution has run after the request, at
  the accumulator as it then stands, and earns from the one after. Before this a
  vault could `activate` and `distribute` in one transaction and take a full
  share of a backlog that built up before it existed; at launch the first
  activator would have taken all of it. Our crank joins every waiting vault in the
  claims it sends right after each distribution. When nobody has joined yet (launch)
  but vaults are waiting, the free monthly run credits nothing and only advances
  the epoch so they can join; the 100 $GARY path cannot do that, so a first
  activator cannot open the door alone. (Round 25 D2: the monthly clock starts at
  the charter close, so nothing can be credited before close + 30 days, and then
  only by a 100 $GARY burn after that tick; the first FREE crediting payout is at
  close + 60 days.) And **no distribution runs while a vault
  already eligible to join is still waiting** (`JoinWaitingFirst`, refused before
  any $GARY burns): the suite found that otherwise whoever reached a due month
  first could tick, join only themselves, and take the next distribution alone.
  Joining is free and anyone's; the crank joins every eligible vault before it
  distributes. It also makes every join exact: nothing is credited between a
  vault becoming eligible and joining, so `debt = weight x acc` at join is right.
- `claim(vault)`, **permissionless**: pays `weight * acc - debt` into **the vault's
  own cbBTC ATA**, the same destination v5's distributor paid. Because the
  destination is fixed to the vault, anyone can crank it, and the money never
  passes through a wallet. Our crank pays only transaction fees (~2,100 claims
  per drop in batches of 14, about 150 transactions, under 0.001 SOL at the base
  fee).
- **Weighted, and ONLY activated vaults** (Gary 2026-10-03, restating the
  Schedule of Vaults): weight 2/3/4/5/6 by level, and a vault earns nothing until
  `activate` has seen >= 21,000 sats. Activation proves the vault's cbBTC account
  already EXISTS, so a payout is a plain token transfer and **`claim` must never
  create an account**: it refuses if the destination is missing rather than paying
  rent. `claim` takes several vaults per transaction so one fee covers a batch.
  The per-vault record is a one-time rent deposit paid at mint (~0.0018 SOL,
  1,772,920 lamports on mainnet for the record's 221 bytes, measured 2026-10-06;
  2,429,040 on the test validator). **It is NOT refunded** (stage 3c, red-team 2
  finding 7, which found this sentence promised a refund nothing paid): the record
  is the vault's permanent on-chain history, the level draw's FIFO and every
  vote's snapshot read it, and an address is never reused, so closing it would buy
  a few thousand lamports with a new way to stall the queue.
- **Redemption settles first:** `burn_vault` refuses while the vault is still
  owed a share of one sat or more (`ClaimBeforeBurn`), so the redeemer claims it
  first, in the same transaction or earlier (SPEC REDEEMING step 2); the owed
  share is waived only when the pool is frozen (the forfeit, SPEC 28). It is
  BURN's `retire_redeemed` CPI into MINT, not the claim, that removes the vault's
  weight (the record is never closed, SPEC 49).
- **A bare Core burn:** `retire_burned(vault)`, permissionless, proves the asset
  is burned (Core `Key::Uninitialized`, identified POSITIVELY per round 21),
  removes its weight and returns its unclaimed share to the pool. Without this a
  bare burn would dilute everyone forever.
- **The $CBOB boost** (Gary 2026-10-04: *"Yes you can upgrade by burning CBOB. We
  just don't know exactly what yet"*; he chose a TEMPORARY boost, outside the
  level caps, priced by a Governor vote and off at launch, with the $CBOB mint
  created first). The vault's owner burns `boost_price` $CBOB (a real SPL Burn of THE mint
  pinned at `initialize`) for an ACTIVATED vault, which then weighs
  `boost_weight` more for the next `boost_epochs` distributions. Its level and the
  census never change, and votes are per vault, so a boost buys payout share only.
  One boost per vault at a time, and ONLY ITS CURRENT OWNER may buy it (Gary
  2026-10-04, after round 23: "no gifted boosts"; a gift would fill the one slot
  for N distributions and take the owner's own timing away). The vote sets all three terms; only weight and payout count have ceilings fixed at
  `initialize` (`max_boost_weight`, `max_boost_epochs`). Price has no launch ceiling, and 0 turns
  boosts off again; a boost already bought keeps its terms.
  **Exact by construction:** the payout accumulator only moves at a
  distribution, so the boost is measured in distributions; the distribution that
  ends one makes it DUE, and no distribution runs while one is due
  (`BoostsExpireFirst`, the `JoinWaitingFirst` pattern). Expiring is free and
  anyone's: `expire_boosts` needs only the vault records, `claim` expires too, and
  the crank does it every pass. A weight change moves what the vault is owed into
  a per-vault `carry` and restarts its debt at the new weight, so a lower weight
  can never need a negative debt and nothing earned is ever lost or gained.
  **A boost is N distributions, not N months**, and anyone can run a distribution
  by burning 100 $GARY whenever the pool holds something new (Gary 2026-10-04:
  "that's part of the game theory on boosts"). The buyer signs the terms they saw
  (`max_price`, `min_weight`, `min_epochs`); a vote landing in between that
  moves them AGAINST the buyer (price up, weight down, epochs down) refuses the
  boost and burns nothing, and a move in the buyer's favour lands at the new
  terms (round 24, D1).

The census and the denominator stay public: `total_active_weight` and per-level
counts are on-chain state anyone can read.

## 4. The emergency brake: the guardian stops, only a vote restarts

Two one-way switches, each callable by the guardian alone and instantly:

- `emergency_stop_sales()` sets `sales_stopped = true`. `mint_vault` refuses.
- `emergency_stop_sweep()` sets `sweep_stopped = true`. `sweep_sol_for_swap`
  refuses, which is the answer to a stolen swap operator key.
- `cancel_swap_operator()` (stage 3c, Gary 2026-10-03) clears a voted swap
  operator that is still inside its notice. It installs nobody and cannot touch
  the operator in office: it is a stop.

**Neither has an "off" for the guardian.** Clearing either flag is a governance
proposal. Redemption, burn, activation, distribution and claims are NEVER
affected by either switch: a member can always get their Bitcoin out and always
be paid.

**What a stolen guardian key can do, stated plainly:** stop sales and stop the
swap until a vote restarts them, and do it again after each restart. It cannot
touch a vault, a payout, or a rule. The cure is a vote that **replaces the
guardian** (`arm_guardian`, governance only). Stage 3c (red-team 2 finding 2):
that vote needs YES from **half of ALL live vaults** (round 25 D1: live when the
proposal was CREATED, GOV's `quorum_supply` snapshot; a vault minted during the
vote can neither vote nor raise the bar, so with a sale round open a 240-vault
snapshot needs 120 YES, which would be 5.71% of 2,100 if the rest minted
mid-vote), may not share a proposal with
a new swap operator, and lands only after a **7-day notice** (`apply_guardian`,
anyone). Until then the guardian in office keeps its brake and cannot cancel its
own replacement. A stolen guardian key therefore holds sales shut for the vote
plus the week at best, and for good while fewer than half of all live vaults
vote YES to replace it (SPEC 47, round 24); that is the price of a brake no
captured vote can remove in one breath. A guardian of `None` is legal, so the community can also retire the
brake entirely, by the same rule.

⚠️ **Consequence to state, not to re-argue:** with immutable programs, a bug in
minting is stopped in seconds by the guardian, but it can never be fixed; sales
stay stopped unless a vote decides the bug is tolerable.

## 5. There is no admin

Every v5 admin power moves to governance or disappears: rotating admin (gone),
adding a reserve mint (gone: SEAL's reserve list is written once at `initialize`,
all three slots filled, and no instruction appends to it), the non-money wiring
fields (governance), the admin half of royalties (gone: fixed at 10% by Core).
The guardian is not an admin: its whole surface is the stop instructions above.

## 6a. The charter claim: one window, scheduled, then gone forever

Gary 2026-10-03: *"We open it on schedule for the burns to burn and claim their
vault. That will close in x days (probably 7) and then that can never be
re-activated again."*

- `charter_opens_at` and `charter_closes_at` (= opens + N days, N about 7) are
  written ONCE in `initialize` and no instruction can change them, governance
  included. There is no `set_charter_round`.
- `claim_charter_vault` is the ONLY path that accepts a Proof of Burn: the owner
  signs, the program CPI-burns exactly one PoB they hold, and mints the vault at
  price 0. Outside the window it refuses, forever, by clock comparison alone, so
  "can never be re-activated" holds with no flag anyone could flip.
- Charter claims and paid rounds are separate instructions. `set_round`
  (governance) never accepts a PoB and refuses any price below the floor, so a
  vote cannot recreate a free round (Gary agreed 2026-10-03).
- **Window length: 7 days** (Gary 2026-10-03, later the same day, REVISING the
  14 he agreed that morning; the Chairman's charter-claim film states seven
  days on an immutable surface, so `initialize` must match it). Dates announced
  before it opens, personal reminders at open, midpoint, 48h and 24h.
- **RULED (Gary 2026-10-03):** a PoB not burned by the close is "just a
  collectible now"; its vault is never minted. **"No pause during that round"**:
  the charter clock never pauses. ⚠️ Read as: the guardian's stop does not apply
  to `claim_charter_vault` at all, so the brake cannot cost a holder their claim.
  Confirmed by Gary 2026-10-03.
- **Voted rounds are priced in cbBTC, with a floor in SATOSHIS** (Gary
  2026-10-03: "We mint in cBTC and it's a minimum number of satoshi's").
  `mint_vault` takes payment as a cbBTC transfer into the revenue address's cbBTC
  account, so **mint revenue needs no swap at all**; the swap operator remains only
  for royalty SOL. `set_round` refuses any price below `MIN_ROUND_PRICE_SATS`,
  a constant compiled into the program (no `initialize` argument sets it). No oracle. The floor drifts in dollars with BTC, which
  is the product's own unit. Reference point when proposed: cbBTC $84,870
  (Jupiter, 2026-10-03), so $50 = ~58,900 sats and $100 = ~117,800 sats.
  **RULED (Gary 2026-10-03): `MIN_ROUND_PRICE_SATS = 21_000`**, the same number
  as the activation seed and an echo of the 21M cap (~$18 today, $210 at $1M BTC).
  The vote sets each round's real price at or above it.

## 6b. Royalties: 10%, forever

Gary 2026-10-03: *"it stays at 10%. We only keep 1.5% of that 10% the other 8.5%
goes to existing vault holders."* The collection's Royalties plugin is set ONCE at
1000 bps with the revenue PDA as sole creator, and `set_collection_royalties` is
deleted; there is no governance action for it. The 85/15 split then gives 8.5%
of every resale to activated vaults and 1.5% to the CBOBTC Squads. **The build
must prove nothing else can change the plugin**, including whoever holds the Core
collection's update authority.

## 6. Bootstrap: the first sale happens before anyone can vote

With no admin and immutable programs, governance is the GOV program's PDA from
the first instruction, and a vote needs vaults that do not exist yet. So the
**charter claim window is set once, inside `initialize`**, signed by the guardian
wallet as `INIT_AUTHORITY` (section 6a). Every later round is a vote, and the charter members are the first voters.

The same one-time call fixes everything that can never change afterwards, so
each value must be decided BEFORE deploy: voting period (`min_voting_secs`, days
not seconds), quorum and threshold, the sweep cap and cooldown, the SOL fee
reserve, `max_supply`, the level census, the 85/15 destinations, and
the key-change notice (7 days), and the three bounds no vote may tighten past
(section 7 B). **Those that governance may later
change are listed in the build; those it may not are permanent the moment the
upgrade authority is removed.**

## 7. Stage 3b — governance can only reach what may safely change (Gary 2026-10-03)

From red-team 1 (`audits/v6-redteam/RT1-c0a9806.md`, finding 1: the first charter
vault could carry any vote alone). Gary approved all five:

- **A. Permanent at `initialize`, no vote can touch them:** `split_bps` (85/15),
  both destinations (the program pool and the CBOBTC Squads), and `max_supply`
  (2,100). Delete them from `UpdateWiring`.
- **B. Swap bot:** a vote may only TIGHTEN its limits (lower `max_sweep_lamports`,
  raise `sweep_cooldown_secs`, raise `sol_reserve_lamports`). Replacing the
  operator key is a vote PLUS a 7-day notice before it applies; the guardian's
  sweep stop covers the gap. **Stage 3c:** that vote needs YES from half of ALL
  live vaults (as snapshotted when the proposal is created; vaults minted during
  the vote cannot vote on it, round 25 D1), never shares a proposal with a
  guardian change, the guardian may
  cancel it inside the notice, and every tightening stays inside three bounds
  fixed at `initialize` (`sweep_floor_lamports`, `cooldown_ceiling_secs`,
  `reserve_ceiling_lamports`): red-team 2 showed an unbounded "tighten" of the
  reserve to u64::MAX locked every royalty lamport for ever.
- **C. No proposal can be created before `charter_closes_at`.**
- **D. Minimum turnout:** YES votes must be at least 10% of the live supply
  snapshotted at creation, on top of the existing quorum/threshold rule.
- **E. One proposal may carry several actions** (e.g. Brakes restart + SetRound),
  executed atomically in order. Also fixes RT1 finding 2 (executing a later
  passed proposal first must not kill an earlier one). **Stage 3c:** an action a
  newer decision has overtaken (an older round, guardian or operator; a round
  already over; a restart voted before the stop it would lift) is SKIPPED and
  logged `CBOB_ACTION_SKIPPED`, never a revert, so it cannot take its bundle down
  with it (red-team 2 finding 6).

## 8. Redemption rate limit, ON-CHAIN (Gary 2026-10-03)

At most **2.1% of live vaults may be redeemed per hour**, whoever signs and
wherever. Purpose: if Gary Club custodial wallet keys ever leak, a thief cannot
empty them faster than we can move those vaults to fresh keys (a transfer is not
rate-limited; a redemption is). At 2,100 live vaults that is 45/hour (ceil of 44.1), falling as live supply
falls (BURN recomputes the cap from live supply at every redemption), so emptying
all 2,100 takes about 209 hours, 8.7 days (round 30 model).

- **Small supply** (Gary: "when QTY is so small we have to let the last ones"):
  the cap is `ceil(2.1% x live)` with a floor of 1, so the last vaults can always
  get out.
- A true ROLLING window (stage 3c, red-team 2 finding 4): BURN keeps the times of
  the last 64 redemptions and refuses one unless the cap-th most recent is at
  least an hour old, so **no hour, starting anywhere, holds more than the cap**.
  Stage 3b's token bucket held a full hour AND refilled continuously, which let
  2x the cap through in one rolling hour. Enforced in the redemption pair (one
  place), counted per redemption.
- Every redemption is posted publicly to X (@cbobtc) and the CBOB website (Gary:
  "YES post to X and on our CentralBankOfBitcoin Website"). Off-chain, after the
  fact; the cap is the control, the posts are the alarm.
- ⚠️ ACCEPTED LIMITS: in a rush, honest holders queue (self-custody too); an
  attacker can spend the hour's budget by redeeming their OWN vaults, which burns
  them, so blocking an hour costs ~45 vaults; a bare Core burn is not a redemption
  and is not limited (it releases nothing).

## 9. Distribution is triggered by a 100 $GARY burn, or monthly (Gary 2026-10-03)

Gary: *"claims are free but the distribution is what fills their vault ... They
can't claim their own from our bank. They can only trigger a distribution for
[a] $GARY burn ... Let's do 100 $GARY burn or Monthly (we do monthly no matter
what)."* Replaces `EMISSION_MIN_PER_VAULT` and the 31-day ceiling entirely.

- `distribute` (credits the pool to every activated vault by weight) succeeds if
  the caller burns exactly **100 $GARY** in the same instruction, OR **30 days**
  have passed since the last one (free; our job runs it monthly regardless).
  Refused when there is nothing to distribute, so nobody burns for nothing.
- `claim` stays free and only DELIVERS what a distribution already credited into
  the vault's own cbBTC account. Undistributed revenue is claimable by nobody.
- A holder who opens their vault without first triggering a distribution leaves
  the undistributed revenue to everyone else. That is the incentive to burn.
- **The monthly path runs with no human and no burn** (Gary 2026-10-03). A program
  cannot wake itself, so: (1) our scheduled job sends it; (2) once due, any
  mint, charter claim, activation, claim or redemption runs it in-line; (3) anyone
  may call it free; (4) the alarm pages if 30 days pass with no distribution.
- 100 $GARY was ~$8.83 when ruled ($0.0883, Jupiter 2026-10-03). Fixed forever.

## 10. Governance numbers (Gary 2026-10-03), fixed at initialize

**Voting period 3 days. Quorum 21% of live vaults** (Gary revised 20 -> 21 the same
day: reachable early on purpose, so the community can get things done in the
early days). **Threshold 51% YES of votes cast.** Minimum YES is therefore 10.71%
of live vaults, above the 10% turnout floor.
Concentration measured the same day from mainnet (240 PoB, 42 holders): the
largest wallet holds 41 (17.1%), the top three 37.9%. If 15% or more of PoBs go
unclaimed (about 20% at 21% quorum), the largest holder alone reaches quorum and passes an ordinary
proposal (rounds, prices, restarts). Round 24 (D5): the top three (91) carry a
guardian or swap-operator change on their own if 58 or more of the 240 (24.2%) go
unclaimed, since no paid vault can exist before a round vote executes; and an
ordinary proposal can open a round with a cap of 2,100 at the 21,000-sat floor
(a sell-out at the floor).

## 11. Red-team 2 rulings (Gary 2026-10-03)

- **RT2-1, the Giraffish Moments update authority stays the hot inventory wallet**
  (Gary: "we keep it and it will stay secure"). Program-side mitigations still
  ship: the PoB burn passes through any external-plugin accounts so a benign
  collection hook cannot brick claims, and the alarm pages on ANY plugin or
  authority change to collection `F9TDm35J…`. Reaffirmed 2026-10-05 ("Keep it
  hot, document it") with the full consequence stated: through the 7-day charter
  window that key can block every claim (no vault, so no vote and no round, ever)
  or admit only its own Proofs of Burn (their vaults the whole electorate). SPEC
  46; in the holder guide's honest list.
- **RT2-2 approved:** replacing the guardian or arming a new swap operator needs
  YES from at least **50% of ALL live vaults** (not of votes cast; live as
  snapshotted at the proposal's creation), each takes a
  7-day notice, the two can never share a proposal, and the guardian may CANCEL
  a pending swap-operator change (a stop power).
- **RT2-4: the 2.1%/hour redemption cap STAYS** (Gary: "Keep the 2.1% per hour cap
  on unlocking vaults"). Fix the 2x burst: no rolling hour may exceed the cap.
  Holder copy must not claim it stops a key thief who transfers vaults first.
- RT2-3, 5, 6, 7 are fixed without a ruling (bounded tighten, activations join at
  the next distribution, superseded action is a no-op, initialize checks).

**Red-team 3** (`audits/v6-redteam/RT3-stage3c.md`, no CRITICAL or HIGH) found
one MEDIUM and six LOW, all fixed in stage 3c: a frozen pool no longer locks every
activated vault (the redemption forfeits its undelivered share instead of
refusing, and the in-line monthly run does not credit from a frozen pool; an
explicit `distribute` still can, and our crank does not send one while the pool
is frozen); GOV refuses a
reserve below rent exemption as MINT does; a newer round that is already over
still supersedes older ones; the monthly clock starts when the charter window
closes; the crank skips burned vaults, distributes before it sends activations
and does not page when traffic already ran the month; and the charter claim with
an Oracle pass-through is measured to fit (the claim page sends no crank then).

**Built in stage 3c**, every item above with a both-ways arm in the suite:
half-of-all-vaults + unbundled + 7-day notice for the guardian and the swap
operator, the guardian's cancel, `TightenSweep` bounded by `sweep_floor_lamports`,
`cooldown_ceiling_secs` and `reserve_ceiling_lamports` (fixed at `initialize`,
refused at proposal creation), the two-step activation, an overtaken action as a
logged `CBOB_ACTION_SKIPPED` no-op, the rolling redemption window, `initialize`
refusing a default 15% destination / a payment mint SEAL does not hold / a SEAL
or MINT naming another collection, the Proof of Burn burn passing an Oracle's
accounts through (tested against a real Core Oracle plugin), and the alarm paging
on any plugin OR update-authority change to the Proof of Burn collection.

## What we still do not control, after all of this

- **Metaplex Core** is upgradeable by Metaplex. We detect a change; we cannot stop one.
  A change could make every redemption refuse, halt the level queue, or widen who
  may approve an `ExecuteV1` through a vault's wallet (SPEC accepted limit 40).
- **cbBTC has a live freeze authority (Coinbase).** Coinbase can freeze any cbBTC
  account, vaults included. Nothing on Solana can prevent it.
- **The swap operator key** converts royalty SOL to cbBTC off-chain, rate-limited
  on-chain by cap x cooldown. It is a hot key on our box, and the swap also rests
  on the Orca, Meteora and Pyth programs, each upgradeable by its own key (SPEC
  accepted limit 10).
- **The unreleased $CBOB** sits in one hot release wallet on our box (SPEC
  accepted limit 56).
- **Immutability makes every surviving bug permanent.** That is the reason the
  audit gate and the Test Vault simulation must pass BEFORE the upgrade authority
  is removed.

## Build order

1. Gary approves this document.
2. Programs: drop the Bank (SEAL, BURN, MINT); drop admin, add the guardian's two
   one-way stops, governance-only restart and `set_guardian`; two-step level
   reveal; PoB burn on charter mint; vote snapshot by mint index; pool + activate /
   distribute / claim / retire_burned; burn settles the stake record.
3. Suite: rewrite every Bank-dependent test, add both-direction tests for each new
   instruction. Retire `bank/cosign.mjs`, `bank/deck.mjs`, `bank/distribute.mjs`'s
   payment path, `scripts/bank-sign.sh`.
4. **Test Vault simulation** on a local validator with real mainnet Core and the
   real $GARY, $GIRAFFISH and cbBTC mint accounts cloned: mint, reveal, load all
   three, activate, attack (owner alone, no burn, partial sweep, wrong vault's
   burn, nested vault, airdrop, old owner after transfer, bare Core burn), claim a
   distribution, redeem, burn, confirm the address can never be reused.
5. Freeze, two clean audit rounds (different rosters), then mainnet dress
   rehearsal with throwaway program IDs and small real amounts, including one
   full live revenue cycle through BOTH pools and one forced post-sweep failure
   recovered by hand (SPEC item 22, round 25 L5).
6. Deploy, verify the deployed bytes, **remove the upgrade authority**.

## Open, needs Gary

- ~~`EMISSION_MIN_PER_VAULT`~~ deleted by section 9.
- ~~The three tighten bounds~~ **RULED (Gary 2026-10-03, "approved"):** floor
  **1 SOL** per sweep (`sweep_floor_lamports = 1_000_000_000`), cooldown ceiling
  **24 hours** (`cooldown_ceiling_secs = 86_400`), reserve ceiling **0.1 SOL**
  (`reserve_ceiling_lamports = 100_000_000`). The worst a hostile vote can then do
  to royalty SOL is slow it to 1 SOL per 24 hours (about 0.96 SOL a day at the
hourly job's cadence) and hold back 0.1 SOL. Fixed forever at
  `initialize`.
- **RULED (Gary 2026-10-03, by text: "2 - yes"):** the swap bot STARTS at 10 SOL per
  sweep, 6 hours between sweeps, 0.05 SOL kept in the revenue address. A vote may
  only tighten these, and only within the bounds above.
- **Still open:** the charter window's opening date (Gary: "not 100% yet") and the
  lock deadline that follows from it; `vault_collection`, created at road step 10;
  and the mainnet dress rehearsal (Gary will run it at the terminal).
- Every `initialize` value in section 6, including the charter round window.
