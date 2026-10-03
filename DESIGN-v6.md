# CBOB Vaults v6: the program is the second signer

**Status: DESIGN, not built. Decided by Gary 2026-10-03.** Nothing in `programs/`,
`bank/` or `scripts/` has changed yet. When it does, the freeze counter resets to
zero (see `audits/FREEZE.md`), deliberately: v6 is the version we will launch, so
it is the version that must earn the two clean rounds.

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
cap. **v6: a charter mint CPI-burns exactly one Proof of Burn token held by the
owner, in the same instruction.** 1 PoB = 1 free vault (Gary 2026-08-13), and the
burn is the coupon being spent. ⚠️ OPEN: the PoB mint address and token program
must be read from chain and pinned, not typed from memory.

### Levels: random at mint, with no deck and no salt
v5's committed deck needed a party that knew the deck and kept it secret during
minting, which was the Bank, and that is exactly why the Bank controlled the
queue (accepted limit 24). With no Bank the deck would have to be public, and a
public deck lets a bot watch `minted_total` and snipe the Level V positions.

v6 replaces the deck with a **two-step reveal from a future slot hash**:

1. `mint_vault` creates the vault, takes payment, records `reveal_slot =
   current_slot + K`, and leaves the level unset. The minter has already paid,
   so they cannot abort a bad outcome.
2. `reveal_level(vault)`, **permissionless**, reads the `SlotHashes` sysvar for
   the first PRODUCED slot at or after `reveal_slot` (round 21: slots get
   skipped), computes `r = sha256(slot_hash || asset)`, and draws WITHOUT
   REPLACEMENT from the remaining census: `r mod sum(level_caps - level_minted)`
   walked across levels I..V. Exact quotas hold by construction.

Nobody knows the slot hash when they submit the mint, so simulation-and-retry is
useless. Our app and a crank reveal within seconds.

**A missed reveal is RESCHEDULED, never penalised** (Gary 2026-10-03: "We can't
lock everyone in the lowest level"; this replaces stage 2's expiry-to-lowest).
`SlotHashes` holds ~512 slots (~3.4 min). If nobody captures a vault's entropy in
that window, anyone may reschedule it to a fresh FUTURE slot, so the new hash is
unknown at the time of the call. Every mint, charter claim, activation and claim
captures entropy for ripe queued vaults, alongside our crank, so a lapse needs a
crank outage AND no protocol traffic for the whole window. Every reschedule is
alarmed. ⚠️ ACCEPTED LIMIT: a minter who has computed their lapsed draw can let
it lapse for one re-roll per window, only during such an outage. The leader of
the target slot can also skip it (two outcomes, not many).

**What this deletes:** `commit_seed`, `commit_deck`, the deck root, the Merkle
proof in the mint transaction, `bank/deck.mjs`, the salt ceremony, accepted
limits 23 and 24, and the packet squeeze between the deck proof and provenance
attributes. All of rounds 20 and 21's worst findings lived there.

### No mint may vote on a proposal opened before it
v5 Bank duty (refuse to co-sign a mint during an open vote) and accepted limit 15.
v6: the vault's mint index is recorded on the asset, each proposal snapshots
`minted_total` at creation, and a vote from an index at or above the snapshot is
refused on-chain.

## 2. Redemption without a Bank

Unchanged in shape: `open_for_redemption` (SEAL) ... sweeps ... `burn_vault`
(BURN), one transaction, each half binding asset AND owner, the emptiness proof
untouched. Remove `bank: Signer` and the Bank checks from both programs.

**What the Bank's pre-sign scan did, and where it goes:** it refused a redemption
that would destroy undeclared holdings (an airdropped token, a nested vault). The
chain still cannot list what a PDA holds, so this moves into **our redeem app as
a hard warning before the owner signs**. Who is protected: the redeemer, from
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
  asset-signer PDA). If it holds >= 21,000 sats and the level is revealed, adds
  the level weight (2/3/4/5/6) to `total_active_weight` and creates the vault's
  stake record with `debt = weight * acc`.
- **Why this cannot be gamed by funding a vault for a moment:** a sealed vault's
  contents cannot leave except by redemption, and redemption burns the vault. A
  balance can only go UP. Activation is therefore permanent for the vault's life,
  which is precisely the property v5 said made an activation instruction unsafe
  (it would have put the Bank between funding and being paid; here nobody
  stands there, anyone can call it).
- `distribute()`, **permissionless**, moves the pool into the accumulator:
  `acc += amount * 1e12 / total_active_weight`. The cadence rule ports directly:
  allowed when a Level I vault would receive >= `EMISSION_MIN_PER_VAULT`, or 31
  days have passed. Dust stays in the pool and carries, matching the ruling.
- `claim(vault)`, **permissionless**: pays `weight * acc - debt` into **the vault's
  own cbBTC ATA**, the same destination v5's distributor paid. Because the
  destination is fixed to the vault, anyone can crank it, and the money never
  passes through a wallet. Our crank pays only transaction fees (~2,100 claims
  per drop, on the order of 0.01 SOL).
- **Weighted, and ONLY activated vaults** (Gary 2026-10-03, restating the
  Schedule of Vaults): weight 2/3/4/5/6 by level, and a vault earns nothing until
  `activate` has seen >= 21,000 sats. Activation proves the vault's cbBTC account
  already EXISTS, so a payout is a plain token transfer and **`claim` must never
  create an account**: it refuses if the destination is missing rather than paying
  rent. `claim` takes several vaults per transaction so one fee covers a batch.
  The per-vault stake record is a one-time rent deposit (~0.0015 SOL at ~80 bytes,
  to measure), refunded when the vault is burned.
- **Redemption settles first:** `burn_vault` requires the vault's stake record to
  be claimed and closed earlier in the same transaction, which removes its weight.
- **A bare Core burn:** `retire_burned(vault)`, permissionless, proves the asset
  is burned (Core `Key::Uninitialized`, identified POSITIVELY per round 21),
  removes its weight and returns its unclaimed share to the pool. Without this a
  bare burn would dilute everyone forever.
- **Level-ups by burning $CBOB** (not built yet) must settle the claim and adjust
  weight in the same instruction.

The census and the denominator stay public: `total_active_weight` and per-level
counts are on-chain state anyone can read.

## 4. The emergency brake: the guardian stops, only a vote restarts

Two one-way switches, each callable by the guardian alone and instantly:

- `emergency_stop_sales()` sets `sales_paused = true`. `mint_vault` refuses.
- `emergency_stop_sweep()` sets `sweep_paused = true`. `sweep_sol_for_swap`
  refuses, which is the answer to a stolen swap operator key.

**Neither has an "off" for the guardian.** Clearing either flag is a governance
proposal. Redemption, burn, activation, distribution and claims are NEVER
affected by either switch: a member can always get their Bitcoin out and always
be paid.

**What a stolen guardian key can do, stated plainly:** stop sales and stop the
swap until a vote restarts them, and do it again after each restart. It cannot
touch a vault, a payout, or a rule. The cure is a vote that **replaces the
guardian** (`set_guardian`, governance only), which can ride in the same
proposal as the restart. A guardian of `None` is legal, so the community can
also retire the brake entirely.

⚠️ **Consequence to state, not to re-argue:** with immutable programs, a bug in
minting is stopped in seconds by the guardian, but it can never be fixed; sales
stay stopped unless a vote decides the bug is tolerable.

## 5. There is no admin

Every v5 admin power moves to governance or disappears: rotating admin (gone),
adding a reserve mint (governance; the list is already full at 3), the non-money
wiring fields (governance), the admin half of royalties (governance alone). The
guardian is not an admin: its whole surface is the two stop instructions above.

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
  fixed at `initialize`. No oracle. The floor drifts in dollars with BTC, which
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
`EMISSION_MIN_PER_VAULT` if it lives on-chain. **Those that governance may later
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
  sweep stop covers the gap.
- **C. No proposal can be created before `charter_closes_at`.**
- **D. Minimum turnout:** YES votes must be at least 10% of the live supply
  snapshotted at creation, on top of the existing quorum/threshold rule.
- **E. One proposal may carry several actions** (e.g. Brakes restart + SetRound),
  executed atomically in order. Also fixes RT1 finding 2 (executing a later
  passed proposal first must not kill an earlier one).

## 8. Redemption rate limit, ON-CHAIN (Gary 2026-10-03)

At most **2.1% of live vaults may be redeemed per hour**, whoever signs and
wherever. Purpose: if Gary Club custodial wallet keys ever leak, a thief cannot
empty them faster than we can move those vaults to fresh keys (a transfer is not
rate-limited; a redemption is). At 2,100 vaults that is 44/hour, ~48h to drain.

- **Small supply** (Gary: "when QTY is so small we have to let the last ones"):
  the cap is `ceil(2.1% x live)` with a floor of 1, so the last vaults can always
  get out.
- Smooth, not bucketed: a token bucket refilled continuously, so no 2x burst at
  an hour boundary. Enforced in the redemption pair (one place), counted per
  redemption.
- Every redemption is posted publicly to X (@cbobtc) and the CBOB website (Gary:
  "YES post to X and on our CentralBankOfBitcoin Website"). Off-chain, after the
  fact; the cap is the control, the posts are the alarm.
- ⚠️ ACCEPTED LIMITS: in a rush, honest holders queue (self-custody too); an
  attacker can spend the hour's budget by redeeming their OWN vaults, which burns
  them, so blocking an hour costs ~44 vaults; a bare Core burn is not a redemption
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
proposal (rounds, prices, restarts).

## 11. Red-team 2 rulings (Gary 2026-10-03)

- **RT2-1, the Giraffish Moments update authority stays the hot inventory wallet**
  (Gary: "we keep it and it will stay secure"). Program-side mitigations still
  ship: the PoB burn passes through any external-plugin accounts so a benign
  collection hook cannot brick claims, and the alarm pages on ANY plugin or
  authority change to collection `F9TDm35J…`.
- **RT2-2 approved:** replacing the guardian or arming a new swap operator needs
  YES from at least **50% of ALL live vaults** (not of votes cast), each takes a
  7-day notice, the two can never share a proposal, and the guardian may CANCEL
  a pending swap-operator change (a stop power).
- **RT2-4: the 2.1%/hour redemption cap STAYS** (Gary: "Keep the 2.1% per hour cap
  on unlocking vaults"). Fix the 2x burst: no rolling hour may exceed the cap.
  Holder copy must not claim it stops a key thief who transfers vaults first.
- RT2-3, 5, 6, 7 are fixed without a ruling (bounded tighten, activations join at
  the next distribution, superseded action is a no-op, initialize checks).

## What we still do not control, after all of this

- **Metaplex Core** is upgradeable by Metaplex. We detect a change; we cannot stop one.
- **cbBTC has a live freeze authority (Coinbase).** Coinbase can freeze any cbBTC
  account, vaults included. Nothing on Solana can prevent it.
- **The swap operator key** converts royalty SOL to cbBTC off-chain, rate-limited
  on-chain by cap x cooldown.
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
   rehearsal with throwaway program IDs and small real amounts.
6. Deploy, verify the deployed bytes, **remove the upgrade authority**.

## Open, needs Gary

- `EMISSION_MIN_PER_VAULT` (provisional 21 sats) before anything runs live.
- Every `initialize` value in section 6, including the charter round window.
