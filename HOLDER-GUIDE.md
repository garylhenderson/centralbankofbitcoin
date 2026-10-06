# Your Vault, in plain English

**DRAFT, 2026-10-03.** Written from DESIGN-v6.md, not from marketing. Every
sentence here must stay TRUE of the deployed programs. If a rule changes, this
file changes in the same commit. This is the source for the website, the claim
page and the redeem page. No em dashes in anything derived from it.

## The four things you ever do

1. **Get a vault.** Burn your Proof of Burn during the 7-day charter window, or
   buy one in a sale round (paid in cbBTC, never less than 21,000 sats).
2. **Fill it.** Send cbBTC, $GARY or $GIRAFFISH to your vault's deposit address
   (the Bank's pages show it; it is not the NFT's own address). Once it
   holds at least 21,000 sats of cbBTC, it is **activated**: it joins the payouts
   at the next distribution and earns from every one after that.
3. **Vote, if you want to.** One vault, one vote, on sale rounds and prices.
4. **Open it, once.** Opening releases everything inside to you and burns the
   vault forever. There is no way to open it and keep it.

Everything else happens on its own. Your level is drawn for you a few seconds
after you get your vault. Activation is picked up automatically. A payout is due
every month: our payout job runs it, ordinary activity runs it too, and if both
ever stopped, anyone can run it for free.

**The first payout cannot happen until a month after the charter window closes,
not even by burning $GARY:** until then no vault has joined the payouts. At that
one-month mark, the vaults activated by then join. From then on a 100 $GARY burn
can run a payout, and the first free monthly payout comes a month after that.
Everything the Bank has earned before the first payout is shared by the vaults
in it.

## What is true about your vault, always

- **Only you can open it.** Not a vote, not anyone. Opening needs your wallet's
  signature and nobody else's. If your vault is in a Gary Club wallet, Gary Club
  holds that wallet's key, so it could sign too; in your own wallet, nobody but
  you can (see the honest list). (It can still have to wait: the hourly limit
  below, a Coinbase freeze, or something in the vault that must come out first.)
- **Nothing can leave it while it is closed.** Not even by you. What goes in
  stays in until the day you open it.
- **Opening is all or nothing.** Everything in it (cbBTC, $GARY, $GIRAFFISH and
  SOL) comes out and the vault is destroyed in the same moment. Anything else in
  it is destroyed with the vault (see "Things to know before you open"). A vault
  can never be partly emptied: it is either sealed with everything still inside,
  or gone.
- **Your level never changes.** It is drawn at random just after your vault is
  created, from block data that did not exist when you got it, and written onto
  the vault. (The validator that produces the last of those blocks can choose
  among many results, and a draw nobody records in time is drawn again; see the
  honest list.)
- **The rules cannot change.** The programs are locked at launch. Nobody holds a
  key that can rewrite them, including us. That also means a bug cannot be fixed,
  and Metaplex can still change the NFT standard underneath (see the honest
  list).

## How you get paid

- Every sale, and the 10% royalty (fixed forever) on every resale where the
  marketplace pays it, flows into the Bank.
  **85% goes to activated vaults. 15% goes to the CBOBTC treasury.** Fixed forever.
- Sales are paid in cbBTC. Royalties arrive in SOL, so a swap bot (a key, not the
  programs) turns that SOL into cbBTC before it is split. It trades only through
  fixed pools (Orca, with Meteora as the fallback) and refuses any price below a
  floor taken from Pyth's price feed. See the honest list for what its key could
  take.
- Your share depends on your level:

  | Level | Share, compared to Level I |
  |---|---|
  | I | 1x |
  | II | 1.5x |
  | III | 2x |
  | IV | 2.5x |
  | V | 3x |

- Payouts are credited to your vault every month once due and delivered **inside
  your vault**, in cbBTC. Anyone can speed one up by burning 100 $GARY, but not
  before the first month after the charter window closes (see above). Anything
  credited to you stays yours until it is delivered (the one exception is
  opening your vault while the Bank's pool is frozen; see the honest list).
- **Before you open your vault**, anything the Bank has received since the last
  payout is not yours yet. If you want your share of it, trigger a payout first
  (100 $GARY), then open. The redeem page offers this and does the steps for you
  (a payout can only run once every newly activated vault has joined, which the
  page also does, free). A vault activated since the last payout has not joined
  yet, so this does not help it.

### Boosting your vault with $CBOB

- You can burn $CBOB to **boost** an activated vault. For the next few payouts
  it counts for more, then it goes back to its level's share by itself. Your
  level never changes, and neither does your vote.
- A **community vote** sets how much $CBOB a boost costs, its extra weight and
  its number of payouts. Only the extra weight and payout count have ceilings
  fixed at launch that no vote can exceed; the price has no such launch ceiling.
  **Boosts are off until the first such vote.** A boost you already bought keeps
  the terms you bought it under.
- The $CBOB is **burned**, gone for good. A boost buys a bigger share of the
  next payouts, and a payout is only as big as the sales and royalties behind it.
  Part of what you are bidding for is bitcoin your own purchase helped put there.
- A boost can add a lot. A Level I counts 2 and a Level V counts 6; a boost can
  add up to 12 while it lasts, so a boosted vault can out-earn higher levels.
- A boost lasts a number of **payouts, not months**. Anyone can trigger an extra
  payout by burning 100 $GARY whenever there is something new to pay, so a boost
  can run out sooner than you expect. That is part of the game.
- You sign the price and terms you see. If a vote changes them against you before
  your boost lands (a higher price, less extra weight, or fewer payouts), it is
  refused and nothing is burned. A change in your favour goes through, at the new
  terms.
- One boost per vault at a time, and only the vault's owner can boost it.
- At launch the Bank holds all 2,100,000,000 $CBOB in one online wallet and
  releases it over time, so nobody can boost until some is released (see the
  honest list for what that wallet means).
- Nothing you have already earned is touched when a boost starts or ends.

## Things to know before you open

- **Send only cbBTC, $GARY or $GIRAFFISH into a vault.** Anything else (another
  token, another NFT, another vault) is destroyed when the vault is opened. The
  redeem page (being built) will check and warn you before you sign.
- **Opening is limited to 2.1% of the vaults still sealed in any hour** (about 45
  an hour at 2,100 vaults), for everyone. It slows any mass emptying of vaults. In a busy hour you
  may wait in line.
- **If Coinbase freezes your vault's cbBTC**, you cannot open it at all (not even
  to take the $GARY and $GIRAFFISH) until Coinbase unfreezes it. Payouts owed to
  it stay owed.
- **Only open your vault on the Bank's redeem page.** Burning the NFT any other
  way (a wallet's "burn" button, another app) destroys everything inside it
  forever. Nobody can stop that, and nobody can undo it.
- **A vault held by a multisig or a DAO cannot be opened.** Keep it in a normal
  wallet: self-custody (Phantom, Ledger) or your Gary Club wallet.
- **Every opening is public.** It is announced on X and on the Bank's website.

## Who can do what

| | can | cannot |
|---|---|---|
| **You** | open your own vault, vote, trigger a payout | open anyone else's |
| **The community vote** | open sale rounds, set prices (21,000 sats minimum), set or switch off the $CBOB boost terms (weight and payout count within the launch ceilings), restart sales after an emergency stop, replace the guardian or the swap bot's key (only with yes from half of all vaults that exist when the vote opens, and only after a week's public notice; vaults minted during the vote cannot vote on it) | change the 85/15 split, the 10% royalty, the 2,100 cap, or touch any vault |
| **The guardian (Gary's wallet)** | stop sales or the swap bot in an emergency, and cancel a new swap-bot key before it takes over | restart them, open a vault, move any money, change any rule, or block its own replacement |
| **Gary Club** | run the payout job and the level draw (anyone can); open or move a vault kept in a Gary Club wallet, because it holds that wallet's key; during the 7-day charter window, hold a key that could block every charter claim or let through only its own; hold, online, the swap bot's key and the wallet with the unreleased $CBOB (see the honest list for all three) | change any rule, or open or move a vault in a wallet whose key it does not hold |

## The honest list

- **Coinbase controls cbBTC.** Coinbase can freeze any cbBTC account, including a
  vault or the Bank's pool. Nothing on Solana can prevent that. If the pool is
  frozen, payouts stop until it is unfrozen, but **you can still open your vault**
  and take everything inside it; only payouts credited and not yet delivered stay
  behind for the vaults that remain.
- **A bug cannot be fixed.** Once the programs are locked at launch, nobody can
  change them, so a bug found later stays for good. If the bug is in sales or
  the swap bot, the guardian can stop them, and they stay stopped unless a vote
  restarts them. A bug in opening vaults, payouts, voting or the charter claim
  cannot be stopped at all. That is why every test, the simulation and a trial
  run on the real network must pass before the lock.
- **Metaplex controls the NFT standard** (Core) the vaults are built on, and
  Metaplex can change it. Our programs are locked and cannot adapt. A change
  could stop every vault from being opened, stop the level draw for every vault
  still waiting for one, or change who is allowed to act through a vault's
  wallet (today only its owner can). We watch Core and are alerted to any
  change, but we cannot prevent one.
- **Resale royalties depend on the marketplace.** The 10% is fixed on the
  collection, but Solana does not force a marketplace to pay it.
- **The level draw is fair, not perfect.** It uses block data that did not exist
  when you got your vault, but the validator producing the last of those blocks
  can pick among several results, by skipping a block or changing what goes
  into it. That can be enough to choose the level of a vault created in the same
  moment (from the levels still left), and one choice affects every vault
  created in that moment at once.
- **A draw nobody records in time is drawn again.** Your vault's draw must be
  recorded within about two minutes of becoming possible. If nobody records it
  in that time, a fresh one is drawn later. The draw can be worked out from
  public data before it is recorded, so the minter could use this to turn down a
  draw they dislike. It only works if nobody records the draw in those two
  minutes: anyone can record it, and our job tries every minute.
- **The swap bot's key is kept online, on our server.** Whoever holds it (us, or
  someone who stole it) could keep up to 10 SOL of royalty money every 6 hours
  (the launch settings; a vote can only make that smaller) until the guardian stops
  it. It can never touch a vault, the pool, or the cbBTC paid for vaults.
  Replacing the key takes a vote and a week's notice. Even an honest swap can
  come in up to 1.5% below Pyth's price, and further if Pyth's own price is off.
- **All $CBOB not yet released sits in one online wallet, on our server** (and
  in its backups). Anyone who stole that key could sell it, or burn it to boost
  vaults they own, at whatever boost terms a vote has switched on, which would
  shrink everyone else's share of those payouts. Nobody can create more $CBOB
  or freeze anyone's.
- **During the 7-day charter window, one Gary Club key could decide who gets a
  vault.** The Proofs of Burn live in the Giraffish Moments collection, and Gary
  Club keeps that collection's key in an online (hot) wallet, by choice. Until the
  window closes, whoever holds that key could add a rule that blocks every
  charter claim. No vault would then exist, and with no vault nobody could ever
  vote, so no sale round could ever open and the project could not start. Or the
  rule could let through only Proofs of Burn that the key holder owns. Their
  vaults would then be the only voters: they alone would decide the guardian and
  the swap bot's key, sale rounds and prices, and the $CBOB boost terms. Once the
  window closes, nobody can do this any more.
- **A newly activated vault can catch about an hour of extra sales.** Sales
  money waits in the Bank briefly before it is split into the pool. A vault that
  has just become eligible can, with the right timing and as little as one
  100 $GARY burn (when the monthly payout is due, the other payout can be the
  free one), share in what was waiting. It costs the vault owner, and the Bank splits every pass
  to keep it small; if the Bank's job stopped, the waiting amount could grow.
- **Someone could send a tiny amount into your vault while you are opening it.**
  On the redeem page that cannot block the opening. The page will first set up
  any of your vault's three cbBTC, $GARY and $GIRAFFISH accounts that do not
  exist yet, and then empty the vault at the very moment the opening runs,
  inside the same all-or-nothing step: whatever cbBTC, $GARY, $GIRAFFISH or SOL
  is in it right then comes out to you. Opening some other way does not have
  this protection.
- **If you lose your wallet's key, your vault is gone.** No one can recover it.
- **If someone steals your key, they own your vault.** Self-custody or your
  Gary Club wallet, protect the key. A Gary Club wallet's key is held by Gary
  Club, so anyone who stole it from Gary Club could do the same. The hourly
  limit slows how fast vaults can be opened, not how fast they can be moved.
