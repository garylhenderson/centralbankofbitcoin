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

**The expiry case is designed so nobody wants it.** `SlotHashes` holds ~512
slots (~3.4 min). If nobody reveals in that window, the vault gets the LOWEST
level still available. The only party who could prefer expiry is a minter who
dislikes their draw, and they cannot see the draw without revealing it, and
anyone else can reveal it for them. ⚠️ To measure: the leader of the target slot
can skip it and push the draw to the next slot (two outcomes, not many). State it
as an accepted limit with its cost.

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
- **Window length: 14 days** (Gary agreed 2026-10-03), dates announced before it
  opens, personal reminders at open, midpoint, 48h and 24h.
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
  ⚠️ OPEN: the number (recommended 100,000 sats = 0.001 BTC).

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
