# Your Vault, in plain English

**DRAFT, 2026-10-03.** Written from DESIGN-v6.md, not from marketing. Every
sentence here must stay TRUE of the deployed programs. If a rule changes, this
file changes in the same commit. This is the source for the website, the claim
page and the redeem page. No em dashes in anything derived from it.

## The four things you ever do

1. **Get a vault.** Burn your Proof of Burn during the 7-day charter window, or
   buy one in a sale round (paid in cbBTC, never less than 21,000 sats).
2. **Fill it.** Send cbBTC, $GARY or $GIRAFFISH to your vault's address. Once it
   holds at least 21,000 sats of cbBTC, it is **activated**: it joins the payouts
   at the next distribution and earns from every one after that.
3. **Vote, if you want to.** One vault, one vote, on sale rounds and prices.
4. **Open it, once.** Opening releases everything inside to you and burns the
   vault forever. There is no way to open it and keep it.

Everything else happens on its own. Your level is drawn for you a few seconds
after you get your vault. Activation is picked up automatically. Payouts arrive
in your vault every month.

## What is true about your vault, always

- **Only you can open it.** Not Gary Club, not a vote, not anyone. Opening needs
  your wallet's signature and nothing else.
- **Nothing can leave it while it is closed.** Not even by you. What goes in
  stays in until the day you open it.
- **Opening is all or nothing.** Everything comes out and the vault is destroyed
  in the same moment. A vault that exists is a vault that is full.
- **Your level never changes.** It is drawn at random when your vault is created,
  from a number nobody can know in advance, and written onto the vault.
- **The rules cannot change.** The programs are locked at launch. Nobody holds a
  key that can rewrite them, including us.

## How you get paid

- Every sale and every resale royalty (10%, fixed forever) flows into the Bank.
  **85% goes to activated vaults. 15% goes to the CBOBTC treasury.** Fixed forever.
- Your share depends on your level:

  | Level | Share, compared to Level I |
  |---|---|
  | I | 1x |
  | II | 1.5x |
  | III | 2x |
  | IV | 2.5x |
  | V | 3x |

- Payouts are credited to your vault at least once a month and delivered **inside
  your vault**, in cbBTC. Anyone can speed one up by burning 100 $GARY. Anything
  credited to you stays yours until it is delivered (the one exception is
  opening your vault while the Bank's pool is frozen; see the honest list).
- **Before you open your vault**, anything the Bank has received since the last
  payout is not yours yet. If you want your share of it, trigger a payout first
  (100 $GARY), then open. The redeem page offers this and does the steps for you
  (a payout can only run once every newly activated vault has joined, which the
  page also does, free). A vault activated since the last payout has not joined
  yet, so this does not help it.

## Things to know before you open

- **Send only cbBTC, $GARY or $GIRAFFISH into a vault.** Anything else (another
  token, another NFT, another vault) is destroyed when the vault is opened. The
  redeem page checks and warns you before you sign.
- **Opening is limited to 2.1% of all vaults in any hour**, for everyone. It slows
  any mass emptying of vaults. In a busy hour you may wait in line.
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
| **The community vote** | open sale rounds, set prices (21,000 sats minimum), restart sales after an emergency stop, replace the guardian or the swap bot's key (only with yes from half of all vaults, and only after a week's public notice) | change the 85/15 split, the 10% royalty, the 2,100 cap, or touch any vault |
| **The guardian (Gary's wallet)** | stop sales or the swap bot in an emergency, and cancel a new swap-bot key before it takes over | restart them, open a vault, move any money, change any rule, or block its own replacement |
| **Gary Club** | run the payout job and the level draw (anyone can) | anything the rules do not allow anyone |

## The honest list

- **Coinbase controls cbBTC.** Coinbase can freeze any cbBTC account, including a
  vault or the Bank's pool. Nothing on Solana can prevent that. If the pool is
  frozen, payouts stop until it is unfrozen, but **you can still open your vault**
  and take everything inside it; only payouts credited and not yet delivered stay
  behind for the vaults that remain.
- **Metaplex controls the NFT standard** (Core) the vaults are built on.
- **If you lose your wallet's key, your vault is gone.** No one can recover it.
- **If someone steals your key, they own your vault.** Self-custody or your
  Gary Club wallet, protect the key.
