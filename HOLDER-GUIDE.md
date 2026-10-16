# Your Vault, in plain English

**Holder guide, updated 2026-10-16.** Written from DESIGN-v6.md, not from marketing. Every
sentence here must stay TRUE of the deployed programs. If a rule changes, this
file changes in the same commit. This is the source for the website, the claim
page and the redeem page. No em dashes in anything derived from it.

The founding charter window opens Monday, October 19, 2026, at noon Austin time
and closes Monday, October 26, at noon Austin time. Those dates are permanent on
chain. A charter claim is free, apart from network fees and account rent. The
vault starts empty; a claim is not its activation deposit.

All five Bank programs are permanently locked. Locking was completed on
October 16, 2026, at 06:56:21 Austin time (11:56:21 UTC). Every upgrade authority was removed;
two independent providers confirmed the successful finalized transactions,
unchanged program code and absence of all five authorities. Nobody can upgrade
those programs, including the Bank. Read the [dated lock record and transaction
receipts](https://centralbankofbitcoin.com/notices/program-lock-2026-10-16/).
Holder services and the trading desk are enabled. Charter claims still open October 19 at noon Austin time.

## The four things you ever do

1. **Get a vault.** Burn your Proof of Burn during the 7-day charter window, or
   buy one in a sale round (paid in cbBTC, never less than 21,000 sats).
2. **Fill it.** Send cbBTC, $GARY or $GIRAFFISH to your vault's deposit address
   (the Bank's pages show it; it is not the NFT's own address). Once it
   has its level and holds at least 21,000 sats of cbBTC, request **activation**.
   It joins after a distribution and earns from the following one, subject to
   the charter timing below. A deposit alone does not begin payouts.
3. **Vote, if you want to.** One vault, one vote, on sale rounds and prices.
4. **Open it, once.** Opening releases your vault's cbBTC, $GARY, $GIRAFFISH
   and SOL to you and burns the vault forever. There is no way to open it and keep it.

Everything else happens on its own. Your level is drawn after you get your vault;
the draw job checks every minute, and busy queues can take longer. Activation is
picked up automatically. A payout is due
every month: our payout job runs it, ordinary activity runs it too, and if both
ever stopped, anyone can run it for free.

**No vault joins the payout pool earlier than 30 days after charter close.**
The first automatic payout is no earlier than 60 days after close. After joining,
a payout triggered by burning 100 $GARY may occur sooner, when new funds are
available. A date does not guarantee an amount.
Everything the Bank has earned before the first payout is shared by the vaults
in it.

## What is true about your vault, always

- **Only you can open it.** Not a vote, not anyone. Opening needs your wallet's
  signature and nobody else's. If your vault is in a Gary Club wallet, Gary Club
  holds that wallet's key, so it could sign too; in your own wallet, nobody but
  you can (see the honest list). (It can still have to wait: the hourly limit
  below, or a Coinbase freeze.)
- **Nothing you put in can leave it while it is closed.** Not even by you. What
  goes in stays in until the day you open it. The one exception is another CBOB
  vault sent into it: the rescue (below) moves that one to the Bank's multisig,
  which returns it to whoever sent it.
- **Opening is all or nothing.** The cbBTC, $GARY and $GIRAFFISH in your
  vault's own three accounts, and its SOL, come out and the vault is destroyed
  in the same moment. Anything else in
  it may be destroyed with the vault (see "Things to know before you open"). A vault
  can never be partly emptied: it is either sealed with everything still inside,
  or gone.
- **Your level never changes.** It is drawn at random just after your vault is
  created, from block data that did not exist when you got it, and written onto
  the vault. (The validator that produces the last of those blocks can choose
  among many results, and a draw nobody records in time is drawn again; see the
  honest list.)
- **After the program lock, the Bank's code cannot change.** Once the programs
  are locked, nobody holds a key that can rewrite them, including us. That also means a bug cannot be fixed,
  and Metaplex can still change the NFT standard underneath (see the honest
  list).

## How you get paid

- Every sale, and the 10% royalty (fixed forever) on every resale where the
  marketplace pays it, flows into the Bank.
  **85% goes to activated vaults. 15% goes to the Bank's treasury.** Fixed forever.
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
  before 30 days after the charter window closes and the vault has joined (see above). Anything
  credited to you stays yours until it is delivered, with two exceptions:
  opening your vault while the Bank's pool is frozen (see the honest list),
  and burning your vault any other way than opening it here, which gives a
  credited share that has not been delivered back to the pool.
- **Before you open your vault**, anything the Bank has received since the last
  payout is not yours yet. If you want your share of it, trigger a payout first
  (100 $GARY), then open. The redeem page offers this and does the steps for you
  (a payout can only run once every boost that has run its course is ended and
  every newly activated vault has joined, which the page also does, free). A vault activated since the last payout has not joined
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

- **Send only cbBTC, $GARY or $GIRAFFISH into a vault.** Anything else can be
  lost when the vault is opened. The redeem page (built, and published before launch) will take out the
  other ordinary tokens it safely can, along with everything else. Before you
  sign, it will name what it cannot take out (for example another NFT, a
  Token-2022 token, a frozen token, a token whose issuer can freeze accounts, or
  anything that does not fit), and you must tick each box, because it is
  destroyed with the vault. If there are more than 20 such things, they share one
  box that gives the count and lists the first 20. If the page cannot list or
  check everything at the deposit address, it says so in one more box you must
  tick: anything it could not see is destroyed too. Another vault is the exception: the rescue (see the
  honest list) gets it back to its sender. Opening some other way may give you no
  warning at all.
- **Opening is limited to 2.1% of the vaults still sealed in any hour** (about 45
  an hour at 2,100 vaults), for everyone. It slows any mass emptying of vaults. In a busy hour you
  may wait in line.
- **If Coinbase freezes your vault's cbBTC**, you cannot open it at all (not even
  to take the $GARY and $GIRAFFISH) until Coinbase unfreezes it. Payouts owed to
  it stay owed.
- **Only open your vault on the Bank's redeem page.** Burning the NFT any other
  way (a wallet's "burn" button, another app) destroys everything inside it
  forever. Nobody can stop that, and nobody can undo it.
- **Leave add-ons off your vault NFT.** If you sign for it, a wallet or app can
  attach extra Core features to it, and the Bank never needs them. Some cannot
  be undone: once you add an autograph book, anyone can sign it, and when it
  holds about 10 KB, Core can no longer empty it or remove any add-on from that
  vault, including delegates you approved. In tests such a vault still drew its
  level, its owner locks still came off, and a transfer and a full opening both
  passed a simulation, but not every combination of add-ons has been tested.
- **A vault held by a multisig or a DAO cannot be opened.** Keep it in a normal
  wallet: self-custody (Phantom, Ledger) or your Gary Club wallet.
- **Every opening is public.** It is announced on X and on the Bank's website.

## Who can do what

| Role | can | cannot |
|---|---|---|
| **You** | open your own vault, vote, trigger a payout | open anyone else's |
| **The community vote** | open sale rounds, set prices (21,000 sats minimum), set or switch off the $CBOB boost terms (weight and payout count within the launch ceilings), restart sales after an emergency stop, replace the guardian or the swap bot's key (only with yes from half of all vaults that exist when the vote opens, and only after a week's public notice; vaults minted during the vote cannot vote on it) | change the 85/15 split, the 10% royalty, the 2,100 cap, or touch any vault |
| **The guardian (Gary's wallet)** | stop sales or the swap bot in an emergency, and cancel a new swap-bot key before it takes over | restart them, open a vault, move any money, change any rule, or block its own replacement |
| **Gary Club** | run the payout job and the level draw (anyone can); open or move a vault kept in a Gary Club wallet, because it holds that wallet's key; during the 7-day charter window, hold a key that could block every charter claim or let through only its own; hold, online, the swap bot's key and the wallet with the unreleased $CBOB (see the honest list for all three) | change any rule, or open or move a vault in a wallet whose key it does not hold |

## The honest list

- **Coinbase controls cbBTC.** Coinbase can freeze any cbBTC account, including a
  vault or the Bank's pool. Nothing on Solana can prevent that. If the pool is
  frozen, no payout can be delivered until it is unfrozen (our payout job stops
  crediting new ones, but anyone can still trigger one, and it is credited and
  waits), but **you can still open your vault**
  and take what its own three accounts and its SOL hold; only payouts credited
  and not yet delivered stay
  behind for the vaults that remain.
- **A bug cannot be fixed.** Once the programs are locked, nobody can
  change them, so a bug found later stays for good. If the bug is in sales or
  the swap bot, the guardian can stop them, and they stay stopped unless a vote
  restarts them. A bug in opening vaults, payouts, voting or the charter claim
  cannot be stopped at all. That is why every test, the simulation and a trial
  run on the real network must pass before the lock.
- **Metaplex controls the NFT standard** (Core) the vaults are built on, and
  Metaplex can change it. After the Bank's programs are locked, they cannot adapt. A change
  could stop every vault from being opened, stop the level draw for every vault
  still waiting for one, or change who is allowed to act through a vault's
  wallet (today only its owner can). We watch Core and are alerted to any
  change, but we cannot prevent one. This is not hypothetical: Metaplex
  upgraded Core three times in the five weeks before launch (3 September,
  7 October and 9 October 2026), the last from source they had not yet
  published. When a changed Core is detected, the watcher queues a diagnostic
  run of the on-chain suite against the new version. That diagnostic is not
  the pre-lock certification. After lock, the Bank cannot change its programs
  to adapt to an incompatible Core upgrade. Before the 16 October 2026 lock, the
  required fresh full suite passed against the exact Core code live on mainnet
  within the preceding 24 hours. That passing test does not prevent Metaplex
  from changing Core afterward.
- **Every vault carries a permanent transfer power, held by the Bank's program.**
  Some wallets and marketplaces show a warning for that. It exists for one job:
  if a vault ends up inside another vault (sent to a deposit address), or
  inside its own, anyone can run the rescue, which moves it to the Bank's
  multisig, and the multisig returns it to whoever sent it. Our payout job
  runs the rescue every hour, and anyone can run it sooner from the vault's
  page. Until it runs, a vault sent into someone else's vault can be kept by
  that vault's owner, who can take it out while opening their own vault. If
  you sent one by mistake, run the rescue at once. The rescue cannot send a
  vault anywhere else, and nothing about the vault changes: its level, its
  seal and everything it earned stay with it. Never send a vault NFT to any
  deposit address.
- **A vault's name and picture are chosen by whoever minted it.** The name and
  the picture's link can never be changed afterwards, but the picture itself is
  hosted wherever the minter put it, so what the link shows can change. A minter
  can even add a lookalike trait such as "Level: V". They do not affect what the vault holds or earns. When buying a
  vault, check its level and contents on the Bank's pages, which read the vault's
  own on-chain record.
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
  is in the vault's own three accounts and its wallet right then comes out to
  you. Tokens in any other account someone sent to the vault come out only if
  the page named them and could move them; anything that arrives after the
  page's last check is lost. Opening some other way does not have
  this protection.
- **If you lose your wallet's key, your vault is gone.** No one can recover it.
- **If someone steals your key, they own your vault.** Self-custody or your
  Gary Club wallet, protect the key. A Gary Club wallet's key is held by Gary
  Club, so anyone who stole it from Gary Club could do the same. The hourly
  limit slows how fast vaults can be opened, not how fast they can be moved.
