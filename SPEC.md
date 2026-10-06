# Central Bank of Bitcoin Vaults: v6 spec (written FROM the implementation)

> **THIS DOCUMENT DESCRIBES v6 AS BUILT** (branch `v6`, programs through stage 3c,
> off-chain pipeline through stage 4, 2026-10-03). It is the map handed to
> independent auditors, and every statement about behaviour is meant to be true of
> `programs/*/src/lib.rs` as they stand. Where a passage records how v5 or an
> earlier v6 stage worked, it says so in its heading or first line, and says what
> replaced it. The rulings behind v6 are in `DESIGN-v6.md`; this file is what the
> code does.
>
> v6 in one paragraph: there is **no Bank key** (the owner alone signs a mint or a
> redemption; the programs' rules are the second party) and **no admin**. A
> **guardian** (Gary's wallet `Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb`, which
> is also `INIT_AUTHORITY` in all four programs) can only STOP: stop sales, stop
> the swap sweep, and cancel a swap operator a vote has armed but not yet
> installed. Only a vote restarts anything. A vote reaches only what may safely
> change. The holders' 85% lives in a **pool** the MINT program owns and pays out
> itself. Levels are **drawn after the mint** from three slot hashes. A one-time,
> 7-day **charter claim** spends one of the 240 Proof of Burns per vault. The
> royalty is **10%, fixed** by Core. Redemptions are capped on chain at **2.1% of
> live vaults per rolling hour**. The CBOBTC Squads
> `bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1` only RECEIVES the 15% and signs
> nothing. The programs are to be made **IMMUTABLE** at launch (upgrade authority
> removed), so whatever survives the audit gate is permanent.

> v1's spec and code disagreed in seven places and auditors flagged the drift as a
> finding in its own right — most dangerously `seal = ["seal", vault_asset]` in the
> spec vs a global `["seal"]` in the code, which would have bricked an entire
> collection at mint. Everything below is read off the source.

**NOTHING IS DEPLOYED. NOTHING HAS MINTED. NOTHING HOLDS REAL VALUE.** v5 went
through twenty-one AI audit rounds and every one of them found something real,
including the last, so that process never converged. v6 is a redesign. Its
three independent red-team passes are in `audits/v6-redteam/`; subsequent
multi-model results, quorum limits and the clean-round counter are recorded in
`audits/FREEZE.md`. THE SHIP GATE is the only thing that decides whether this holds Bitcoin.

**History (v5 rounds, kept because later sections cite them).** Round 6 was the
first to audit ALL FOUR programs together with the off-chain `bank/` pipeline and
the ops scripts. It was also the largest: the alarm's transaction scanner turned
out to be structurally dead after its first pass, the "50 SOL cap" on the trusted
hop existed only in a script that need not be the caller, and admin alone could
appoint itself governance in one instruction (v6 has no admin).

**Rounds 7 through 10 were aimed at the previous round's fixes, and most of what
they found were defects IN those fixes** — including a detector that would
have emailed a CRITICAL every thirty minutes while checking nothing, and a
quorum snapshot that froze the wrong direction. That is the most useful thing a
round can produce, and it is the reason each round is handed the previous
round's repairs and asked whether they are real or merely relocated. Verdicts on
every finding accepted AND rejected: `audits/round5/VERDICT.md` through
`audits/round20/VERDICT.md` (round 17 has no verdict file; round 21's verdict is
the round-21 row of the freeze log in `audits/FREEZE.md`). v6's red-team reports:
`audits/v6-redteam/RT1-c0a9806.md`, `RT2-9be3a7c.md`, `RT3-stage3c.md`.

## What a vault is

A Metaplex Core asset in the CBOB collection. Its contents live in Core's
asset-signer PDA `["mpl-core-execute", asset]`, so the wallet is *derived from* the
NFT — transfer the NFT and the balance goes with it. Contents move only via Core
`ExecuteV1`, which requires the **asset owner's signature**. A
`PermanentFreezeExecute` plugin gates whether Execute is permitted at all; its
authority is the SEAL program's `["seal"]` PDA.

Vaults are **born sealed** — measured, not assumed: the plugin decodes
`frozen: true` and an owner's bare Execute with no `open_for_redemption` is
refused on-chain (Core `0x9`) with the contents intact. They die **exactly once**:
see "Unbreaking IS burning" below.

## THE OWNER ALONE, AND THE PROGRAM'S RULES (v6)

v5 called this TRUE 2-of-2: the owner and a Bank key each had to sign. **v6
(Gary, 2026-10-03: "the program should own the other signature") deleted the
Bank.** The second party to every mint and every redemption is now the programs'
own rules, which nobody can skip because nobody holds a key that can:

| party | holds | cannot do |
|---|---|---|
| **the owner** | the asset, and must sign | cannot unseal without burning in the same transaction (SEAL + BURN refuse) |
| **the programs** | the seal (`["seal"]` PDA), the pool (the MINT config PDA's cbBTC account), the level draw, the revenue address (MINT's `["revenue"]` PDA) | cannot move a vault's contents — Core demands the owner's signature |
| **the guardian** (Gary's wallet) | three one-way stops: `emergency_stop_sales`, `emergency_stop_sweep`, `cancel_swap_operator` (a PENDING operator only) | cannot restart anything, install anyone, open a vault, move money, change a rule, or cancel its own replacement |
| **the swap operator** (a hot key) | `sweep_sol_for_swap`, capped and cooled down on chain, into its own wallet, to swap royalty SOL to cbBTC off chain | cannot touch cbBTC, the pool, a vault or the split; the guardian can stop it instantly |
| **governance** (the vault holders' vote, via GOV's `["gov"]` PDA) | sale rounds and prices, restarts, tightening the swap bounds, the $CBOB boost terms (inside the 12 / 24 ceilings fixed at init), arming a new guardian or swap operator (half of ALL live vaults as snapshotted when the proposal is created + 7 days' notice) | cannot touch the 85/15 split, its destinations, the 2,100 cap, the 10% royalty, a vault, or the reserve list (all fixed at `initialize` or by Core) |

What the Bank's signature used to buy, and what replaced it:
- **The hot Bank key is gone**, and with it the 7-day halt on a lost key, the
  "must stay a plain keypair" constraint, the fee-payer gap and the Bank's
  control of the mint queue (accepted limit 24).
- **The owner's key IS the vault.** A thief holding it can redeem. The on-chain
  cap of 2.1% of live vaults per rolling hour bounds how fast vaults can be
  REDEEMED, and the public post per redemption is meant to make each one visible.
  ⚠️ It does not stop a thief who TRANSFERS the vaults first: transfers are not
  limited (accepted limit 41).
- **The redemption preflight moved to the redeem page**, which is not built: see
  the control table.

### ⚠️ AND NEITHER CAN A VAULT'S OWNER. A DAO CANNOT HOLD A VAULT.

Round 14 (still true in v6). **Any address that cannot sign a
top-level instruction cannot redeem a vault it owns** — the pairing needs two
top-level owner signatures, and a program signs only by CPI. So a DAO buying a
vault (in a sale round, or on the secondary market) from its Squads treasury pays
real money, deposits real cbBTC, and receives a permanently sealed asset.

**`mint_vault`'s `owner: Signer` does NOT prevent this** (nor does
`claim_charter_vault`'s). MINT's comment once claimed it was "strictly stronger"
than an on-curve test; that was wrong, because `is_signer` is TRUE for a PDA
passed as a CPI signer, and the comment now says it is "the best available check,
not a complete one". Suite test 5.2 does not cover it either —
it passes the PDA with `isSigner:false` and is refused by `AccountNotSigner`,
which is a different property. Nothing on-chain can refuse it (`is_on_curve`
panics on BPF), so `detectNestedVaults` reports an off-curve owner at CRITICAL
(`unredeemable_owner`) and that detection is the entire control.

An off-curve owner may also be a marketplace escrow holding a listed vault, which
is recoverable. We do not yet know whether Core marketplaces escrow the asset or
use a transfer delegate, so the finding names both readings rather than guessing.

## UNBREAKING IS BURNING (Gary's ruling 2026-08-22, introduced in v5, unchanged in v6)

> *"THE ONLY WAY to break open a vault is to burn it. We will have our own burn
> mechanics that handle the unbreaking of a vault."*

There is **no operation that empties a vault and leaves it alive**. A vault
either holds its contents or it has ceased to exist. One transaction:

```
open_for_redemption   (SEAL)  thaws — refuses unless a burn_vault for this asset
                              and owner appears later in THIS transaction
  ...sweeps...        (Core ExecuteV1, the owner's own instructions)
burn_vault            (BURN)  refuses unless the open appeared earlier in THIS
                              transaction; proves emptiness; destroys the asset
```

**v2–v4 were the exact inverse of this.** `close_redemption` was terminal, and it
always re-sealed. A redeemed vault survived — empty, transferable, sellable, with
a one-bit `redemption: opened` stamp — and a **partial** sweep was legal: take
half, re-seal, resell to a buyer whose whole stated basis is "this vault still
contains its reserve".

What changed is **which instruction is terminal**. Not one line of the emptiness
proof moved; it is satisfied by a sweep in the same transaction instead of by a
previous one. That is also what makes redemption **all-or-nothing**: anything the
proof can still see refuses the burn, and the thaw reverts with it (tested, 3.11).

Both halves bind **asset AND owner**, in both directions, so neither can be
borrowed from another vault's redemption sharing the transaction (3.9, 3.10, 9.0).
Each program hard-codes the other's discriminator and account positions — a second
copy of a fact, asserted against the Anchor derivation in the suite (3.1a–3.1f).
That coupling **fails closed**: a drift breaks the match, refuses the thaw, and
leaves the vault sealed with its contents intact.

### What got worse, stated plainly

Core cannot enumerate the token accounts or the nested assets a PDA owns, so
`burn_vault` can only refuse **what it is shown**. Under v2–v4 an undeclared
holding survived a burn, stranded. Under v5 every redemption ends in a burn, so
the same gap **destroys** it — Core's `BurnV1` does not sweep the asset-signer
PDA and nothing can ever sign for it again. The gap did not widen. The consequence
did. Measured, section 9:

| | declared | undeclared |
|---|---|---|
| a vault nested inside a vault (9.1: Core permits it) | **refused** (9.4) | **BURNS, inner orphaned forever** (9.5, 9.6) |
| an airdropped non-reserve token (9.7: anyone can) | **refused** (9.8) | **BURNS, tokens destroyed** (9.9) |
| airdropped SOL | refused (9.10) | swept in the same redemption (9.11) |

A **nested vault is unredeemable while nested** (9.3): its owner is a PDA and both
Core's Execute and our open demand the owner's signature.
⚠️ Round 29 (D2): an orphaned vault (nested in a burned host, or in its own
asset-signer PDA) that was ACTIVATED keeps its level weight, and any unexpired
boost, in `total_active_weight` forever. It can never be redeemed
(`retire_redeemed` needs a BURN redemption its PDA owner cannot sign) nor
retired (`retire_burned` needs Core's burn tombstone), so every distribution
credits it a share, and the permissionless `claim` pays that share into the
orphan's own reserve account, inside a vault nobody can ever redeem. That cost
is permanent and falls on EVERY other vault, not only its holder: its weight w
(2 to 6, plus any unexpired boost) out of `total_active_weight` at each
distribution, which is 6,405 plus boosts only when the whole census is active
and is far smaller, so the share far larger, while few vaults are active.
`detectNestedVaults` pages it; nothing on chain can undo it. A program change
to retire such a vault is possible only before the lock and is an owner
decision.

**The only controls on the undeclared cases are off-chain, and here is exactly
what exists today:**

### THE CONTROL TABLE — the ONE place that says what actually runs (v6)

Every comment elsewhere points HERE rather than restating it, because this
project's most repeated defect has been a comment asserting a control that does
not exist — and, once, under-claiming one that did. If you change what runs,
change this table.

The fourth column has exactly three values and they are not degrees of the same
thing:

| | meaning |
|---|---|
| **ON-CHAIN** | a program refuses. Nobody can opt out, including us. |
| **AUTOMATIC** | a cron runs it on a schedule, and reports after the fact. |
| **PROCEDURE** | a human (or a page not yet built) runs it. Real, and skippable. |

**The column is MECHANICALLY TRUE, not a claim.** `bank/selftest.mjs` parses
these rows: an ON-CHAIN row must name program source AND at least one refusal
that really is a variant of that program's error enum (v5 checked the Bank pin;
v6 has no Bank, so the proof is the refusal the program actually emits); an
AUTOMATIC row must name a file `scripts/cron-install.sh` installs; a PROCEDURE row
must name one it does not. All three are proven in both directions.

| control | what it catches | when | **does anything RUN it?** |
|---|---|---|---|
| **THE OPEN MUST END IN A BURN, AND ONLY THE OWNER CAN DO EITHER** | any thaw that does not end in this vault's burn, by this vault's owner, in the same transaction. `programs/cbob-vaults/src/lib.rs` refuses `NoTerminalBurn` and `NotTheOwner`; `programs/cbob-vault-burn/src/lib.rs` refuses `NoPrecedingOpen`. v6 has no Bank: the owner's signature and these rules are the whole gate (Gary, 2026-10-03: "the program should own the other signature") | every redemption, always | **ON-CHAIN.** Two programs refuse. Nobody can opt out, us included. |
| **THE EMPTINESS PROOF** | a burn while a declared reserve account holds anything, carries a delegate, or a declared nested vault is still inside. `programs/cbob-vault-burn/src/lib.rs` refuses `VaultNotEmpty`, `ReserveDelegated`, `DeclarationMismatch`, `VaultStillHoldsAVault` | every redemption | **ON-CHAIN.** |
| **2.1% OF LIVE VAULTS PER ROLLING HOUR** | a mass drain through leaked owner keys (Gary Club custodial wallets above all): max(1, ceil(live x 2.1%)) redemptions in ANY window of `redeem_window_secs` (3600 on mainnet), wherever it starts. BURN keeps the times of the last 64 redemptions and refuses one unless the cap-th most recent is a full window old. `programs/cbob-vault-burn/src/lib.rs` refuses `RateLimited`. Transfers are NOT limited: that lets custodial vaults be moved to fresh keys, and it equally lets a thief move them first (accepted limit 41) | every redemption | **ON-CHAIN.** |
| **THE GUARDIAN CAN ONLY STOP** | the guardian (Gary's wallet) restarting anything, or anyone else stopping anything. `programs/cbob-vault-mint/src/lib.rs` refuses `NotTheGuardian` (also for a retired guardian), `SalesStopped`, `SweepStopped`, and `StopIsNewer` for a restart voted before the stop it would lift. `cancel_swap_operator` clears only a PENDING operator and refuses `NoPendingOperator` otherwise; the guardian has no instruction that touches a pending guardian | always | **ON-CHAIN.** |
| **NO LEVEL WITHOUT ENTROPY, IN MINT ORDER** | a draw out of order, or from a lapsed window. `programs/cbob-vault-mint/src/lib.rs` refuses `RevealOutOfOrder` and `NeedsReschedule` (a lapse is rescheduled, never defaulted); at mint it refuses `ReservedAttribute` for a caller who writes `level` or `charter` themselves, and `LevelCapReached` once the census is spent | every mint and reveal | **ON-CHAIN.** |
| **A VOTE REACHES ONLY WHAT MAY CHANGE** | a proposal before the charter closes, a vote by a vault minted after the proposal, a pass on thin turnout, a guardian or swap-operator change without half of ALL live vaults (the live supply snapshotted at creation) or bundled together, a sweep "tightening" that loosens or passes the bounds fixed at `initialize`. `programs/cbob-vault-gov/src/lib.rs` refuses `CharterNotClosed`, `VaultTooNew`, `TurnoutTooLow`, `KeyChangeNeedsHalf`, `KeyChangesBundled`, `Loosening`, `TightenOutOfBounds`; `programs/cbob-vault-mint/src/lib.rs` re-checks `TightenOutOfBounds` and `PriceBelowFloor`, and lands a new guardian or operator only after the notice (`GuardianNoticeNotElapsed`, `OperatorNoticeNotElapsed`) | every proposal | **ON-CHAIN.** |
| **ONE PROOF OF BURN, ONE VAULT, ONE WINDOW** | a charter claim outside `[charter_opens_at, charter_closes_at)`, with a Proof of Burn the signer does not own, or with an asset that is not one of the 240 addresses committed in `pob_root`. `programs/cbob-vault-mint/src/lib.rs` refuses `CharterNotOpen`, `CharterClosed`, `NotThePobOwner`, `NotInPobSet`, and burns the Proof of Burn by CPI in the same instruction | every charter claim | **ON-CHAIN.** |
| **THE POOL PAYS ONLY WHAT WAS DISTRIBUTED, ONLY INTO THE VAULT** | a claim paid anywhere but the vault's recorded cbBTC account, a distribution while an eligible vault waits to join, a redemption that leaves an owed share behind (unless the pool is frozen), a retire called from anywhere but BURN's `burn_vault`. `programs/cbob-vault-mint/src/lib.rs` refuses `WrongVaultAccount`, `VaultAccountMissing`, `JoinWaitingFirst`, `ClaimBeforeBurn`, `NotFromBurn`, `WrongPool` | every distribution, claim and redemption | **ON-CHAIN.** |
| **THE ONE-TIME WIRING IS RIGHT OR NOTHING STARTS** | an `initialize` by anyone but Gary's wallet, a collection that arrives with a plugin or already minted, a default 15% destination, a payment mint that is not a SEAL reserve, a SEAL/MINT/BURN/GOV naming different collections, a tighten bound outside its absolute range. `programs/cbob-vault-mint/src/lib.rs` refuses `NotTheInitAuthority`, `CollectionNotClean`, `WrongTreasury`, `PaymentMintNotAReserve`, `WiringDiverged`, `BadSweepBound`; `programs/cbob-vault-burn/src/lib.rs` refuses `WiringDiverged`; `programs/cbob-vault-gov/src/lib.rs` refuses `ForeignVault` | once, at launch | **ON-CHAIN.** |
| **`bank/crank.mjs`** — scheduled permissionless calls | a reveal nobody captured, a vault nobody activated, a month nobody distributed, a claim nobody delivered. Every instruction it sends is permissionless and pins its own destination; its key pays fees and each reveal's Core attribute rent (about 0.0001 SOL, round 23 L14), is refused below what the pass's plan costs, and above 0.25 SOL still RUNS and warns once a day (round 22 F8: refusing let anyone stop it by sending 0.25 SOL). Each LIVE full pass stamps `bank/.crank-heartbeat`. **Installed DRY-RUN**; `--live` on its line arms both lanes | every minute (reveals), hourly (the rest) | **AUTOMATIC.** `bank/crank.mjs`, cron, installed by `scripts/cron-install.sh`. |
| `detectDistributionOverdue` / `detectPoolHealth` / `detectBrakeTransitions` (alarm, EVERY pass) | a distribution all three layers failed to run, a frozen or short pool, a brake pulled or released, a guardian or swap operator armed, a reschedule, a frozen claim, redemptions near the rolling-hour cap, any plugin or update-authority change on the Proof of Burn collection, a program still upgradeable past the lock date, and (round 23) an ARMED crank with no completed full pass in 3 hours (`crank_silent`), royalty SOL left unswept a day (`royalties_unswept`), a frozen or unreadable revenue cbBTC account | post-hoc, ≤30 min | **AUTOMATIC.** `bank/alarm.mjs`, cron, installed by `scripts/cron-install.sh`. |
| `detectNestedVaults` (alarm, EVERY pass) | a CBOB vault owned by any vault's asset-signer PDA, a vault owned by its OWN, and any vault owned by an off-curve address | post-hoc, ≤30 min | **AUTOMATIC.** `bank/alarm.mjs`, cron, installed by `scripts/cron-install.sh`. |
| `detectUndeclaredTokenAccounts` (`--reconcile`) | any token account a vault PDA owns that is not a canonical reserve ATA | post-hoc, daily | **AUTOMATIC.** `bank/alarm.mjs --reconcile`, cron, installed by `scripts/cron-install.sh`. |
| `judgeRedemptionCoverage` — the redeem page's preflight | a redemption that would DESTROY something the vault holds and the burn does not declare (a stray token, a nested vault, a Token-2022 account with extensions). Lives in `bank/detectors.mjs`; v5 ran it inside the Bank's co-signer, which v6 deleted. **The redeem page that must run it before the holder signs is NOT BUILT** | pre-signature, once that page exists | **PROCEDURE.** Nothing runs it today. |
| `bank/redemption-poster.mjs` — every redemption, public | drafts the X / CBOB website post for each `CBOB_REDEEMED`. **Has no sender**: an automated new post on @cbobtc is outside the standing reply authorization and needs Gary's go-ahead, and the website surface is not chosen | after the fact | **PROCEDURE.** Run by hand; drafts only. |

⚠️ **WHAT v6 GAVE UP, STATED HERE SO IT IS NOT DISCOVERED.** v5's Bank co-signed
every redemption and ran `judgeRedemptionCoverage` before it did, so a holder who
had airdropped junk or nested a vault into their vault was REFUSED rather than
allowed to destroy it. v6 removed the Bank (the owner alone redeems), so until the
redeem page exists and runs that check, **nothing stops a holder destroying an
undeclared holding by redeeming**. The three reserve assets are always checked
on-chain; this only concerns things that should not be in a vault at all
(accepted limits 9 and 44; the page itself is item 50, OPEN AND BLOCKING).

### REDEEMING A VAULT (v6) — what the holder signs

No Bank, no co-signer, no sanctioned signing script: v5's `bank/cosign.mjs` and
`scripts/bank-sign.sh` are deleted. A redemption is the owner's own transaction:

1. **(prior transaction)** create the destination token accounts, and (round 24,
   A3) any of the VAULT's three reserve accounts that does not exist yet, so the
   sweep in step 2 can name all three. A 3-asset redemption that also creates
   them does not fit one legacy transaction (stage 3 measured 2 mints only), so
   this step is separate.
2. **(the redemption)** `claim` this vault's credited share into it (⚠️ round 24,
   D4: NOT while the pool's cbBTC account is frozen, see below), then
   `open_for_redemption` (SEAL), the sweep (round 24, A3: one Core `ExecuteV1`,
   signed by the owner, into the sweep helper `programs/cbob-vault-sweep`, which
   moves each named reserve account's LIVE balance and every lamport of the vault
   wallet to the owner and closes the reserve accounts; see "Known limits", the
   round 23 F1 entry), and `burn_vault` (BURN), which checks the rolling-hour cap,
   proves emptiness, burns the asset through Core, retires the vault from the
   payout schedule by CPI into MINT's `retire_redeemed` (refusing
   `ClaimBeforeBurn` if a whole sat is still owed, UNLESS the pool is frozen, in
   which case the undelivered share returns to the pool and the redemption lands,
   logged `CBOB_REDEEMED_POOL_FROZEN`), and counts it in `burned_total` for live
   supply. A due monthly distribution then runs in-line, after the vault has left,
   so it credits only the vaults that remain.

⚠️ **Round 24 (D4): a frozen pool reverts a claim that PAYS.** `claim` does not
check the pool for a freeze; a claim that owes a whole sat moves it out of the pool
with a token `Transfer`, which a frozen pool refuses, so the WHOLE transaction
reverts, the redemption with it. While the pool is frozen a redemption therefore
sends no `claim` and lets `retire_redeemed` forfeit the undelivered share (suite
3c.F2 builds it exactly so). ⚠️ **Round 24 (D8): close what you empty.**
`burn_vault` checks a reserve account's `amount == 0`, not that it is closed, and
after the burn nothing can ever sign for the vault's PDA, so an emptied reserve
account left OPEN strands its rent for good: about 1,488,440 lamports per account
on mainnet, the redeemer's own loss. The sweep helper closes every account it
empties, rent to the owner. Both are client obligations of item 50.

Anything credited by a distribution is delivered into the vault and swept out
with the rest. Revenue the pool holds but has not yet DISTRIBUTED is not the
redeemer's: a holder who wants their share of it triggers a distribution first
(100 $GARY, or wait for the month). That only helps a vault that has already
JOINED the schedule, and a distribution is refused while any vault eligible to
join is still waiting (`JoinWaitingFirst`); joining them is free and anyone's.

## The four programs (v6), and their upgrade authority

Each program is deployed with its own upgrade authority so that the deploy can
happen at all, and **that authority is removed at launch**: Gary's ruling is that
the programs are IMMUTABLE, so nobody, including us, can change a rule after it.
Until it is removed, whoever holds it can replace a program; `bank/alarm.mjs`
reports any of the four, or the sweep helper `programs/cbob-vault-sweep` (round 25
D6: five in all), still upgradeable past the lock date at CRITICAL
(`program_not_locked`): the EARLIER of `launch/mainnet-init.json`'s
`lock_deadline` and MINT's on-chain `charter_opens_at` (round 23, L12). Every `initialize` below is gated on a compile-time
`INIT_AUTHORITY` (Gary's wallet), runs once (the config is an `init` PDA), and is
the only write some of these configs ever receive. There is no admin and no
`update_*` instruction in any program.

**SEAL** `9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273`
- `initialize(collection, reserve_mints)`: 1 to 3 reserve mints, every one
  passed as an account and owned by classic SPL Token (see "Token-2022 is refused"
  below). Production must pass all three (cbBTC, $GARY, $GIRAFFISH): nothing can
  add one afterwards. ⚠️ Round 24 (A6): SEAL checks only each account's OWNER. It
  does not read the account as a mint, refuse a duplicate, or check the
  collection key; the ruled three are pinned by `scripts/check-launch-params.mjs`
  (item 38), and a wrong collection is refused by MINT and BURN (`WiringDiverged`)
  before anything mints.
- `open_for_redemption`: the OWNER signs. Walks the instructions sysvar and
  REFUSES to thaw (`NoTerminalBurn`) unless **`cbob_vault_burn::burn_vault` for
  the same asset and owner** appears later in the same transaction.
- That is the whole program. **There is no `close_redemption`** (removed in v5,
  see "Unbreaking is burning") and no `update_config` (removed in v6).

**MINT** `Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo`

| who may call | instruction | what it does |
|---|---|---|
| `INIT_AUTHORITY`, once | `initialize(bank_treasury, swap_operator, guardian, sol_reserve_lamports, max_supply, max_sweep_lamports, sweep_cooldown_secs, level_caps, payment_mint, pob_collection, pob_root, charter_opens_at, charter_closes_at, monthly_secs, notice_secs, sweep_floor_lamports, cooldown_ceiling_secs, reserve_ceiling_lamports, max_boost_weight, max_boost_epochs)`, with the `cbob_mint` ACCOUNT | fixes the 85/15 split (`split_bps` = 8,500, not a parameter), the 15% destination, the pool (derived, not a parameter), `max_supply`, the level census, the charter window, the Proof of Burn root, every period and every bound; sets governance to GOV's `["gov"]` PDA (derived, not a parameter); refuses a collection that is not clean, not ours, or already minted; installs the collection's Royalties plugin at 10% with plugin authority NONE; refuses unless SEAL already names the same collection and holds `payment_mint` as a reserve; pins the $CBOB mint (an initialized classic SPL mint, neither cbBTC nor $GARY) and the two boost ceilings (`BadBoostSetup`) |
| the owner (+ payer) | `mint_vault(name, uri, max_price, attributes)` | a vault in a VOTED round, paid in cbBTC into the revenue address; refuses while sales are stopped |
| the owner (+ payer) | `claim_charter_vault(name, uri, attributes, pob_proof, pob_extra)` | a free vault for one Proof of Burn, burned by CPI, inside the charter window only; NOT gated by the guardian's stop |
| anyone | `capture_entropy`, `reschedule_reveal`, `reveal_level(attributes)` | the level draw (see "The level") |
| anyone | `activate`, `distribute(burn)`, `claim(crank_n)`, `retire_burned` | the community pool (see below) |
| the vault's owner | `boost_vault(max_price, min_weight, min_epochs)` | the $CBOB boost (item 51): burns `boost_price` of the pinned $CBOB mint for an activated, live vault the signer owns; refuses `BoostsOff`, `BoostTermsMoved` (terms moved AGAINST the signed ones), `BoostNotTheOwner`, `BoostActive` |
| anyone | `expire_boosts` | ends DUE boosts (up to 30 records a call); `distribute` refuses while one is due (`BoostsExpireFirst`) |
| BURN's `burn_vault`, by CPI only | `retire_redeemed` | takes a redeemed vault off the schedule |
| anyone | `split_revenue(decimals)` | the enforced 85/15, cbBTC only |
| the swap operator | `sweep_sol_for_swap(amount)` | royalty SOL to the operator, capped, cooled down, above a reserve |
| the guardian | `emergency_stop_sales`, `emergency_stop_sweep`, `cancel_swap_operator` | one-way stops |
| governance (a ratified GOV proposal, by CPI) | `set_round(opens_at, closes_at, price, cap)` | price >= 21,000 sats (`PriceBelowFloor`), cap > 0, window at most a year |
| governance | `restart(sales, sweep, proposal_created_at)` | lifts a stop, refusing `StopIsNewer` for a vote created before the stop |
| governance | `tighten_sweep(args)` | sweep bounds, tighter only, never past the `initialize` bounds |
| governance | `set_boost_terms(price, weight, epochs)` | the boost terms, inside `max_boost_weight` and `max_boost_epochs` (`BoostTermsOutOfBounds`); a price of 0 turns boosts off |
| governance | `arm_swap_operator(operator)`, `arm_guardian(guardian)` | arms a replacement; nothing changes yet |
| anyone, after `notice_secs` | `apply_swap_operator`, `apply_guardian` | lands the armed key (or, for the guardian, `None`: the brake retired) |

An armed replacement has **no apply-by deadline**. Once its notice has elapsed,
anyone may apply it until a later vote supersedes it. The guardian may cancel a
pending operator, but cannot cancel a pending guardian. This pending state is
separate from GOV's seven-day deadline for executing the proposal that arms it.

**BURN** `8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8`
- `initialize(collection, redeem_window_secs)`: refuses unless SEAL's config
  already names the same collection; the window is 10 s to 24 h and ⚠️ **MUST be
  3600 on mainnet**.
- `burn_vault(declared)`: the OWNER signs. Requires **a preceding
  `open_for_redemption` for the same asset and owner in the same transaction**
  (`NoPrecedingOpen`), the rolling-hour cap (`RateLimited`), PDA lamports == 0,
  every reserve mint's ATA (both token-program derivations) declared, PDA-owned,
  undelegated, extension-free and empty, and no declared account a live Core
  asset. **The reserve list is read out of the SEAL config**, never kept locally.
  Then Core `BurnV1`, then MINT's `retire_redeemed` by CPI, then
  `burned_total += 1`, and the greppable log line `CBOB_REDEEMED <asset>`.

**GOV** `2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2`
- `initialize(collection, quorum_bps, threshold_bps, min_voting_secs)`: refuses
  unless MINT's config names the same collection. Quorum 500 to 10,000 bps,
  threshold above 5,000 and at most 7,500 (unanimity is deadlock), voting period
  60 s to 30 days. **Fixed forever**: there is no `update_gov_config`. Ruled for
  mainnet (DESIGN-v6 section 10): **3 days, quorum 21%, threshold 51%**; the
  alarm asserts the voting period is 259,200 s.
- One vault, one vote. Standing is read live off the asset's owner bytes, and the
  owner signs. `VoteRecord` is a PDA at `["vote", proposal, ASSET]`, so a vault
  votes once per proposal **however many times it changes hands**.
- `create_proposal(actions, voting_ends_at)`: any vault holder, **only once
  `charter_closes_at` has passed** (`CharterNotClosed`). Up to five actions, at
  most one of each kind: `SetRound`, `Brakes` (restart sales and/or the sweep,
  and/or arm a new guardian or `None`), `TightenSweep`, `ArmSwapOperator`,
  `SetBoostTerms` (the $CBOB boost, ordered like a round). A guardian
  change and a new swap operator may never share a proposal (`KeyChangesBundled`).
  Every action is checked at creation against what MINT would accept (price
  floor, window, a tightening that is really tighter and inside the fixed
  bounds), so a vote cannot be wasted on a proposal that cannot land.
- **The electorate and the tally rule are fixed at creation.** `index_snapshot`
  = MINT's `minted_total` then: a vault votes only if its mint index (read from
  MINT's `VaultRecord`) is below it (`VaultTooNew`). `quorum_supply` = LIVE supply
  then: `minted_total - BURN.burned_total - MINT.bare_burns_retired`. The quorum
  and threshold basis points are copied into the proposal. The divisor at
  execute is the snapshot, never `max(snapshot, live)` (v5's rule, see below): a
  vault minted mid-vote can neither vote nor move the bar.
- `cast_vote(support)`: owner signs, before `voting_ends_at`.
- `execute_proposal`: anyone, after voting ends and within **7 days** of it
  (`ProposalExpired`). Passes when votes cast >= ceil(quorum x snapshot) and
  never zero, YES share of votes cast >= the threshold, YES >= ceil(10% of the
  snapshot) (`TurnoutTooLow`), and, for a guardian change or a new swap operator,
  YES >= ceil(50% of the snapshot), i.e. half of all vaults live WHEN THE
  PROPOSAL WAS CREATED (`KeyChangeNeedsHalf`). ⚠️ Round 25 (D1): not of all vaults
  live at execution. While a sale round is open, vaults minted during the vote
  cannot vote (`VaultTooNew`) and do not raise the bar: a 240-vault snapshot needs
  120 YES, which would be 5.71% of 2,100 if the rest minted mid-vote. Round 24 D5
  covered only the charter-close case, where snapshot and electorate coincide. Each action is a CPI into MINT signed by the `["gov"]`
  PDA, all in one instruction: one fails, all revert.
- **Ordering is per KIND and an overtaken action is SKIPPED, never a revert.** An
  older `SetRound`, guardian change or operator arm than one already executed is
  skipped and logged `CBOB_ACTION_SKIPPED`; so is a `SetRound` whose round is
  already over (it still moves the mark, so an older round cannot land after it),
  and a restart half voted before the stop it would lift. The rest of the bundle
  lands. A proposal of nothing but skips still counts as executed.
- A hostile majority is still bounded by MINT: it cannot mint past `max_supply`,
  price a round below 21,000 sats, reopen the charter window, touch the split,
  either destination or the royalty, or reach a vault. SEAL and BURN have no
  governance at all.

### What v5 had here, and what replaced it (history)

v5's MINT had an `admin` and `update_wiring`, `set_paused`,
`set_collection_royalties`, `apply/cancel_pending_governance` and
`apply/cancel_pending_admin`; SEAL had `update_config(bank?, admin?,
reserve_mints?)`; BURN and MINT took a `bank: Signer`; GOV could do exactly one
thing (CPI `set_round`), had an admin-only `update_gov_config`, used the quorum
divisor `max(snapshot, live supply)` over supply EVER minted, and moved execution
forward by one global `last_executed_id`. Two lessons from that era carried into
v6 and are why the v6 rules look the way they do:

- **Rotating a key is a NOTICE PERIOD, not a signature.** Round 6 found admin
  could appoint itself governance in two transactions; rounds 6 and 7 then put
  every rotation behind arm / publish / apply-later, with the alarm reporting a
  pending value at CRITICAL every pass. v6 keeps exactly that shape for the only
  two keys left that a vote can change: `arm_guardian` / `apply_guardian` and
  `arm_swap_operator` / `apply_swap_operator`, 7 days' notice on mainnet, alarm
  kinds `guardian_armed` and `swap_operator_armed`.
- **The gate splits by DIRECTION, not by field.** Round 6 learned that a control
  usable only by a slow vote is not usable in the emergency it exists for, so
  tightening the swap hop had to be faster than loosening it. v6 takes it further:
  the swap hop can only ever be tightened by a vote (inside fixed bounds), and the
  emergency itself is the guardian's instant one-way stop.

⚠️ `min_voting_secs` (GOV), `notice_secs` and `monthly_secs` (MINT) and
`redeem_window_secs` (BURN) each have a short floor that exists ONLY so the suite
can exercise the path. **The deployed values must be 3 days, 7 days, 30 days and
3600 s.** Because v6 is immutable, a launch value set wrong is permanent. The
alarm reports any of these (and the quorum, threshold and three tighten bounds)
that differs from its ruled value as `test_value_in_production` at CRITICAL, but
only after `initialize` has written it, which is why accepted limit 38 is OPEN
AND BLOCKING.

## Cross-program wiring: one source of truth

MINT and BURN read the **SEAL config** as canonical (collection and reserve
list); BURN reads MINT's config for live supply and calls MINT's
`retire_redeemed`; GOV reads MINT's config (governance, supply, charter close,
stops, sweep bounds), BURN's `burned_total` and MINT's `VaultRecord` (mint
index). Every such read is pinned by address, owner, the Anchor discriminator AND
a `version` byte declared as the account's first field, so a layout that moved
fails loudly instead of misreading whatever bytes now sit at that offset. Current
versions: SEAL config 2, MINT config 6, BURN config 4, GOV config 4, VaultRecord 4.
Every layout and every pinned cross-program offset is written once in
`bank/layout.mjs` and asserted there against the Rust structs. Each `initialize`
after SEAL's refuses a sibling that names a different collection (stage 3c), so
the four cannot be wired to two collections.

BURN keeping its own copy of `reserve_mints` was a real defect: a mint added to
SEAL and not to BURN was never derived, never required and never checked, and a
vault holding it burned cleanly. There is now no second copy to diverge.
(v5 history: the copy existed while admin could append to SEAL's list. v6 writes
the list once, so it could not diverge anyway, but BURN still reads SEAL's.)

## Token-2022 is refused at CONFIG time, not at redemption

The ATA program gives every Token-2022 ATA an `ImmutableOwner` extension, so its
length is **170, never 165** (measured). Both reserve checks demand exactly 165 —
deliberately, because a Token-2022 confidential balance reads zero in the base
`amount` field. Together those make a T22 reserve mint a permanent seal: the
burn fails forever, and the open is illegal without a terminal burn. In v5 the
reserve list was additive by admin, so that landmine was one ordinary config
change away. In v6 the list is written exactly once, by SEAL's `initialize`, and
every mint in it must be owned by classic SPL Token there
(`ReserveMintNotClassicSpl`), which turns a customer funds-loss into a failed
deployment.

All three intended reserve mints (cbBTC, $GARY, $GIRAFFISH) are classic SPL,
verified on mainnet.

## PROVEN IMPOSSIBILITIES — do not file these as bugs

1. **A bare Core `BurnV1` by the owner cannot be prevented** while the vault stays
   freely transferable. `PermanentFreezeDelegate` blocks transfer but not burn;
   `FreezeDelegate` blocks both and kills resale. There is no burn-only lock.
2. **Token accounts owned by a PDA cannot be enumerated on-chain.** The reserve
   mints are covered deterministically; anything else rests on **whatever the
   control table says actually runs**, which in v6 is post-hoc detection only
   (`detectUndeclaredTokenAccounts`, `detectNestedVaults`) until the redeem page
   that runs `judgeRedemptionCoverage` before the holder signs is built. (v5 ran
   that check inside the Bank's co-signer, `bank/cosign.mjs`, which v6 deleted.
   Round 15 found this sentence contradicting the control table; it now points
   at it instead of restating it.) **The same is true of nested Core
   assets** — an undeclared inner vault is DESTROYED by a burn exactly as an
   undeclared token account is (measured 9.5/9.9; since v5 every redemption ends
   in a burn, so this is the normal exit rather than an optional extra step).
3. **A vault transferred to its own asset-signer PDA is bricked forever**, and
   Core permits the transfer. Blocked in the UI only. **The same holds one level
   out**: a vault transferred into ANOTHER vault's asset-signer PDA is
   unredeemable while it is there (9.1, 9.3) — a PDA cannot sign, and both Core's
   Execute and `open_for_redemption` demand the owner's signature.
4. **Core's `BurnV1` does NOT sweep the asset-signer PDA** — measured: after a
   burn the PDA still held every lamport and the payer received only the asset's
   own rent. This is why `burn_vault` requires `lamports() == 0` and why the
   frequently-suggested "just let BurnV1 sweep it" would destroy customer SOL.
5. **`Pubkey::is_on_curve` is host-only** — it compiles for BPF and panics
   `not implemented` at runtime. There is no on-chain test for "is this address a
   PDA"; requiring a signature is the enforceable form of the same property.

## Revenue: ONE address in, an enforced 85/15 out

**THE REVENUE ADDRESS — `BXzdn56h93KX5cZryRXab89VpwGtwPzWA4wegqsHCiuX`**
(the MINT program's `["revenue"]` PDA). Every voted-round mint price lands in its
cbBTC account (a `TransferChecked` of the round price inside `mint_vault`), the
collection's `Royalties` plugin names it as the sole creator at 100%, and any
future income source the project adds points here too. Nobody holds its key:
value leaves only through `split_revenue` (the enforced 85/15) or
`sweep_sol_for_swap` (SOL only, bounded, operator-signed, stoppable). Charter
claims are free and pay nothing in.

**Mint prices arrive as cbBTC and need no swap.** Only secondary royalties, which
marketplaces pay in SOL, go through the trusted hop:

| step | where | who |
|---|---|---|
| 1. `sweep_sol_for_swap(amount)` | **on-chain**: destination is the configured `swap_operator`, `amount` > 0 and <= `max_sweep_lamports`, at most one per `sweep_cooldown_secs`, never below `sol_reserve_lamports`, refused while the guardian's sweep stop is on | **the swap operator SIGNS** (`WrongTreasury` for anyone else; a stranger's sweep is refused, 6.17a) |
| 2. swap SOL → cbBTC (a pinned Orca pool, Meteora fallback, Pyth floor; `bank/swap.mjs`) | **OFF-CHAIN — the one trusted hop** | the swap operator key |
| 3. return the cbBTC to the revenue address | off-chain | the swap operator key |
| 4. `split_revenue(decimals)` | **on-chain, enforced**, cbBTC only (`WrongPaymentMint` for any other mint) | permissionless |

`split_revenue` floors the **Squads'** 15% and sends the **remainder** to the
pool, so the rounding goes to the holders and the two transfers still sum to the
balance exactly. (It was the other way round until round 6, under a comment
claiming the opposite: the Bank collected every remainder, and at a balance of 1
it collected all of it. Dust, and a rule stated backwards.) v5 split any token,
to a distributor wallet that could swap it; v6 splits only the payment mint,
because the pool can pay vaults only in cbBTC (accepted limit 29).

**The sweep is bounded IN THE PROGRAM.** History: in round 6 `sweep_sol_for_swap`
was permissionless, so the 50 SOL constant in `bank/revenue.mjs` bound nobody:
anyone could push the whole balance above the reserve to the operator key in one
transaction. `max_sweep_lamports` and `sweep_cooldown_secs` moved into config and
are both enforced (both, because a cap without a rate limit is a step size: three
sweeps in one transaction are refused, 6.17), and the operator must now sign, so
a stranger cannot sweep (6.17a) and a zero sweep, which would burn the cooldown and move nothing, is refused (6.17b). At
`initialize` the cap must be 1 to 50 SOL and the cooldown 1 s to 24 h.

**A vote can only make the hop smaller, and only so far.** `tighten_sweep` takes
the more restrictive of what is live and what was voted, so the order of execution
does not matter and nothing loosens. It can never pass three bounds fixed at
`initialize`: the cap never below `sweep_floor_lamports`, the cooldown never above
`cooldown_ceiling_secs`, the reserve never above `reserve_ceiling_lamports` (and
never between zero and rent exemption). Ruled for mainnet: **1 SOL, 24 hours,
0.1 SOL**, so the worst a hostile vote can do to royalty SOL is slow it to 1 SOL a
day and hold back 0.1 SOL. Red-team 2 found the unbounded version locked every
royalty lamport forever with one vote (reserve = u64::MAX).

| wallet | share | address |
|---|---|---|
| **the community pool**: the MINT config PDA's own classic-SPL cbBTC ATA, derived at `initialize`, never a parameter, written by no later instruction; paid out on chain by `distribute` + `claim` into each activated vault | **85%** | `r3YBji5GgMb2YkkgPGzcX4McBDhR8od1zNS8vYzWiQM` (derived from the program id and the cbBTC mint; no key exists) |
| ~~distributor wallet~~ (v5; DELETED in v6 stage 3) | ~~85%~~ | ~~`4epGVaxS4rYH9q8tvEjuzxCtm9gSWQvmEp9By3uUvYge`~~ |
| CBOBTC Squads (`bank_treasury` in the config; receives only, signs nothing) | **15%** | `bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1` |
| swap operator (transient only) | none | `bipP7uK5aQDsrChYA8hpZ1Thb8BCw7emRGuEkLkHg6G` (generated for launch 2026-10-04; an `initialize` argument, not pinned in code. The v5 key `3QwQnwkr...` was never funded and is retired) |

**Steps 2 and 3 cannot be made trustless without a DEX CPI**, so instead of
pretending otherwise they are made small and counted: every sweep and every
return is written to `bank/revenue-ledger.json`, `revenue.mjs --audit`
reconciles them, and the alarm raises a CRITICAL on a sweep with no matching
return, on a return of ZERO, and on a return well below its quote.

**A compromised operator key is RATE-LIMITED by the program rather than bounded to
one sweep, and the difference matters.** A round-19 auditor was right that a cap
plus a cooldown is a RATE, not a total. The honest bound: **each sweep is capped,
and the exposure is that cap times the number of cooldown windows that elapse
before the guardian pulls `emergency_stop_sweep`**, limited also by what the
revenue PDA holds above `sol_reserve_lamports`. The stop is instant and one-way;
replacing the key is a vote plus 7 days' notice, and the stop covers that week
(6.20h). The program's own floor `MIN_SWEEP_COOLDOWN_SECS` is **one second**,
which only stops several sweeps sharing one transaction; what makes the cooldown
a real rate limit is the deployed value, and `bank/alarm.mjs` raises
`sweep_cooldown_too_short` at **CRITICAL** when it is below the operational
minimum. Detection is the other half: the alarm reports a sweep with no matching
cbBTC return, so the window is the alarm's cadence plus a human reaching the
guardian wallet. **Read the bound as cap x windows, never as "one sweep".**

## Sale controls

- **The charter claim** (`claim_charter_vault`) is the only free path and the
  only one that accepts a Proof of Burn. Its window is written once by
  `initialize` (7 days, ruled), and outside it the instruction refuses by clock
  alone. It is deliberately NOT gated by the guardian's sales stop (Gary: "no
  pause during that round"), so the brake cannot cost a charter member their
  claim. It counts toward `max_supply` and the level census like any mint.
- `set_round(opens_at, closes_at, price, cap)`: **governance only**, reached
  through a ratified GOV proposal. Price in sats of cbBTC, never below 21,000
  (`PriceBelowFloor`), so no vote can make a round free; `cap` > 0 (there is no
  unlimited sentinel); a window of at most a year. Each new round resets
  `minted_this_round`. `mint_vault` takes a payer's `max_price` so a repricing
  between simulation and landing is refused (`PriceAboveMax`, 6.12).
- `emergency_stop_sales`: **the guardian, immediate, one-way.** It gates
  `mint_vault` and nothing else. Stopping does not touch the round, so a restart
  resumes where it was. Only governance can `restart`, and a restart voted before
  the stop it would lift is refused (`StopIsNewer`), so a hostile guardian
  re-stopping cannot move the stop time forward (it is stamped on the transition
  only) and an old restart cannot reopen a new emergency.
  **Redemption, burn, activation, distribution and claims are never affected by
  either stop**: a member can always get their Bitcoin out and always be paid.
- **Royalties are not a control any more.** `initialize` installs the
  collection's Royalties plugin at 1,000 bps with the revenue PDA as sole creator
  and plugin authority NONE, so Core itself refuses every later update or removal,
  from anyone. `set_collection_royalties` (v5: admin and governance) is deleted.

## THE COMMUNITY POOL, ON CHAIN (v6 stages 3, 3b, 3c)

Gary, 2026-10-03: *"the % that goes back to the community should live in the
program"* and *"ONLY activated vaults get their share (so they have the ATA
records open and sending is CHEAP)"*.

| step | instruction | who |
|---|---|---|
| the 85% lands in the pool | `split_revenue` (cbBTC only) | anyone |
| a vault asks to join | `activate`, first call: level drawn, asset live in our collection, its own canonical cbBTC ATA holds >= 21,000 sats. Records a REQUEST in the current distribution epoch | anyone |
| the pool is shared out | `distribute(burn)`: weighted accumulator, Level I..V = 2/3/4/5/6, only over JOINED vaults; every distribution advances `dist_epoch` | anyone (see "What triggers a distribution") |
| a waiting vault joins | `activate` again, or any `claim` that names it, once `dist_epoch` has moved past its request: it enters at the accumulator as it then stands (`debt = weight x acc`) and earns from the NEXT distribution | anyone |
| a vault is paid | `claim` (batched, 14 per legacy tx measured): INTO the vault's recorded cbBTC ATA, never creating one; a frozen ATA is deferred and logged `CBOB_CLAIM_DEFERRED_FROZEN`, still owed | anyone |
| a vault is redeemed | `claim` before the sweep, then BURN calls `retire_redeemed` by CPI (refuses `ClaimBeforeBurn` while a whole sat is owed, unless the pool is frozen, in which case the undelivered share is forfeited back to the pool) | the owner |
| a vault is bare-burned | `retire_burned` returns its unclaimed share to the pool and counts it in `bare_burns_retired` | anyone |

**Why activation joins at the NEXT distribution (stage 3c, red-team 2 finding 5).**
Before 3c a vault joined at once, so `activate` then `distribute` in one
transaction took a full share of a backlog that built up before it existed, and
at launch the first activator took all of it. Two further rules close the
variants the suite found:
- **No distribution while a vault already eligible to join is still waiting**
  (`JoinWaitingFirst`, checked before any $GARY is burned). Otherwise whoever
  reached a due month first could tick the epoch, join only themselves, and take
  the next distribution alone. Joining is free and anyone's; the crank joins every
  eligible vault before it distributes. It also makes every join exact: nothing is
  credited between a vault becoming eligible and joining.
- **What the rule does and does not promise** (round 22, F2): a vault is never
  credited by a distribution that ran BEFORE it joined. Revenue already sitting in
  the pool when it joins is shared at the next distribution by everyone joined
  then, the new vault included. That is the point of the launch tick: the first
  cohort shares the launch backlog. It is NOT "a vault never earns from revenue
  that arrived before it joined".
- **Unsplit revenue is the one remaining edge** (round 22, F1): cbBTC still in the
  REVENUE address (not yet split into the pool) is not part of the distribution
  that makes a new vault eligible, so a vault that requests, makes itself eligible
  and then splits and distributes in one transaction shares that unsplit
  revenue. It costs as little as 100 $GARY (round 24, D1: at the monthly boundary
  the first distribution can be the free `distribute(false)` or a host's in-line
  run, so only the second needs a burn; 200 $GARY otherwise) and a funded,
  revealed vault; the crank splits every
  pass, which bounds the unsplit balance to about an hour of sales. ACCEPTED by
  Gary 2026-10-04 (accepted limit 55).
- **When nobody has joined yet but vaults are waiting** (launch), only the FREE
  monthly path, once due, may run, and it credits nothing: it only advances the
  epoch so they can join (logged `CBOB_EPOCH_TICK`). The 100 $GARY path refuses
  (`NoActiveVaults`), so a first activator cannot open the door alone. The
  monthly clock starts at `max(initialize time, charter_closes_at)` (red-team 3
  finding 5), so that first tick cannot land inside the charter window.
  ⚠️ Round 25 (D2), the consequence for holders: NOTHING can be credited before
  charter close + 30 days (MINT lib.rs 688 starts the clock; 1594-1601 refuse the
  burn path with `NoActiveVaults` and hold the free path to the month). After that
  tick the crank joins the cohort, and a 100 $GARY burn can then pay at once; the
  first FREE crediting distribution is at close + 60 days. The holder guide says
  so in its opening section.

Activation is PERMANENT for a vault's life because a sealed vault's balance can
only rise until it is burned. The pool never holds less than it owes
(`ceil(owed_scaled / 1e12)`, suite P.32; `distribute` refuses `PoolShort`
otherwise); the odd sat that does not divide stays in the pool, owed (P.13).

**A frozen pool never locks a vault (red-team 3 finding 1).** Coinbase holds
cbBTC's freeze authority. With the pool frozen no `claim` can deliver, and a
redemption must settle what it is owed first, so before stage 3c every activated
vault became unopenable for the length of the freeze. Now `retire_redeemed` lets
the redemption land and returns the undelivered share to the pool (logged
`CBOB_REDEEMED_POOL_FROZEN`; 3c.F0-F3), and the in-line monthly run never credits
from a frozen pool. An explicit `distribute` is not refused for a frozen pool; it
can only make vaults owed again, and owed vaults still redeem by the same forfeit.

The per-vault record (`["vault", asset]`, 221 bytes, 2,429,040 lamports of rent
paid by the minter) is **never closed and its rent is not refunded** (red-team 2
finding 7 found DESIGN promising a refund nothing paid). It is the vault's
permanent history: GOV reads its mint index, the reveal FIFO reads it, and an
address is never reused, so closing it would buy a few thousand lamports with a
new way to stall the queue.

⚠️ A redemption of a vault holding all THREE reserve assets must create the
owner's destination accounts in a PRIOR transaction (9.14b/9.14d measured); with
them already open, claim + open + sweep + burn fits (9.14c asserts that it fits;
the 1,169 bytes once quoted here was measured at stage 3, before stage 3b added
the pool account to the burn).

v5's off-chain `bank/distribute.mjs` payment path and its distributor wallet were
deleted in stage 4. What computes "what is owed" off chain now is
`bank/accrual.mjs`, the program's arithmetic mirrored in BigInt for the crank and
the alarm.

## Distribution: THE SCHEDULE OF VAULTS

**Locked by Gary, 2026-08-22.** Five levels, I smallest to V largest. A level is
drawn by the program shortly AFTER the mint, by fate, from the census still
undrawn, and never changes. (Burning $CBOB does not raise a level: by Gary's
2026-10-04 ruling it buys a TEMPORARY boost of weight instead; see item 51.)

| level | share of the census (production `level_caps`) | weight |
|---|---|---|
| I | 45% (945) | 2 |
| II | 25% (525) | 3 |
| III | 15% (315) | 4 |
| IV | 10% (210) | 5 |
| V | 5% (105) | 6 |

The census is `level_caps`, an `initialize` value that must sum to at most
`max_supply`; each cap must be non-zero. The draw is WITHOUT REPLACEMENT from
what is left of it, so the quotas hold exactly by construction (L.18, L.19), and
the odds of any single draw are the remaining counts, not fixed percentages.

```
vault_share_of_a_distribution = amount * vault_weight / total_active_weight
```

An unactivated vault, or one that has asked to activate and not yet joined, has
weight 0. `total_active_weight`, `active_count`, `level_minted` (how many have
been DRAWN at each level) and the accumulator are public on-chain state in the
MINT config, which is what makes a share checkable by the holder instead of taken
on trust. There is no on-chain count of ACTIVE vaults per level.

**A Level V vault receives exactly three times a Level One, absent boosts. Not sixteen.**
A $CBOB boost (item 51) adds up to +12 weight, the ceiling Gary ruled, for N
distributions: a boosted Level I can weigh 14, 2.33x an unboosted Level V, and
with every vault boosted +12 the V : I ratio is 18 : 14. That is the ruling's
consequence, stated so nobody reads the table below as unconditional.
`bank/accrual.mjs --selftest` asserts the 1 : 1.5 : 2 : 2.5 : 3 ratio and that the
shares of one distribution sum to exactly what was distributed. The published
card's census figures (240 vaults: 108/60/36/24/12, denominator **732**; 2,100
vaults: 945/525/315/210/105, denominator **6,405**) are re-derived from the
weights by `bank/accrual.mjs --selftest` (restored in round 22 after
`bank/distribute.mjs`, which used to assert them, was retired).

### The dust carries; it is never split

**v6 (the program).** The accumulator is kept in units of 1e-12 sat per weight
unit, in u128. A distribution adds `floor(amount x 1e12 / total_weight)` to it,
so what it fails to assign is under one scaled unit per weight unit, and it stays
in the pool as undistributed, to go out with the next one. A claim pays whole
sats only; the sub-sat remainder stays in the vault's debt and is paid once it
adds up (accrual selftest, "dust"). Nobody keeps a cut, and nothing is split
between vaults to make a total come out even.

**v5 (the off-chain allocator, history).** v5's `bank/distribute.mjs` paid whole
sats per settlement, and at 2,100 vaults the remainder could be up to **2,099**
sats a settlement, one satoshi short of one per paid vault. ⚠️ This read 6,404
until round 19 (`denominator - 1`: a real upper bound, about three times the
truth); round 18 corrected the same figure in `bank/distribute.mjs` and left this
copy standing. The tight bound was `dust < activated count`. **Gary's ruling, which
v6 keeps by construction: the leftover stays in the pool and goes out in the next
drop.** The alternative (largest-remainder) makes 100% land in the same
settlement at the price of two vaults *at the same level* differing by a sat, and
"your level determines your share" is the whole product.

### What triggers a distribution: 100 $GARY burned, or a month (stage 3b)

Gary, 2026-10-03, replacing the emission-minimum cadence below it in history:
`distribute` is permissionless and succeeds when EITHER

* the caller **burns exactly 100 $GARY** in the same instruction (an SPL `Burn`
  CPI of the mint pinned by address, `8c71Av…`, classic SPL by owner, 9 decimals
  asserted against mainnet by the probe; the supply really falls; a short balance,
  another mint, a Token-2022 lookalike or a plain transfer are each refused by
  name), OR
* **the period has passed** since the last distribution, with no burn ("we do
  monthly no matter what"). The period is an `initialize` value capped at 30 days,
  and ⚠️ **mainnet MUST be initialized at exactly 30 days (2,592,000 s)**.

It is refused, and nothing is burned, when the pool holds nothing undistributed,
no vault has joined (the burn path), or a vault eligible to join is still waiting
(`JoinWaitingFirst`). **The monthly run needs nobody** (Gary: *"the monthly path
should run programmatically without any human interaction and require NO $GARY
burn"*): `mint_vault`, `claim_charter_vault`, `activate`, `claim` and the
redemption (`retire_redeemed`, reached from `burn_vault`) each carry the pool and
perform a due distribution in-line, never refusing their host for being early,
empty or blocked by waiting joins (it logs `CBOB_MONTHLY_WAITS_FOR_JOINS` and does
nothing), exactly once per period (it stamps `last_distribute_at`). In a
redemption it runs after the vault is retired, so the leaving vault is not
credited.

`claim` only delivers what was already distributed; undistributed revenue is
claimable by nobody, so a redeemer who leaves before the next distribution takes
only what was distributed and the rest stays for the vaults that remain (P.22e).

The stage-3 emission minimum, the 31-day ceiling and the 1-sat-per-weight gate are
DELETED, with the `emission_min` config field. The dust rule above is unchanged.

### The level: drawn ON-CHAIN after the mint, written onto the asset (v6)

Gary's ruling (2026-08-23/24): **assign at random, respecting the quantity
allowed, with no way to game it, and mint it to the NFT.** `bank/levels.json` was
deleted then. v5 met it with a committed DECK (a Merkle root dealt by mint index,
from a seed the Bank committed before minting); v6 deleted the deck with the Bank
(stage 2), because a deck nobody keeps secret is a deck a bot can snipe.

| what | how | strength |
|---|---|---|
| the minter cannot choose their level | `level` is a reserved attribute key (`ReservedAttribute`); only `reveal_level` writes it, through MINT's `["mint"]` PDA, which is the Attributes plugin's authority | **prevented on-chain** |
| the minter cannot grind it | the draw is `sha256(hA ‖ hB ‖ hC ‖ asset)` over the hashes of three slots that did not exist when the minter signed and paid: A is the first PRODUCED slot at or after `reveal_slot` (mint slot + 16), B and C each at least two 4-slot leader groups after the previous one | **prevented on-chain**, except the last-contributor residual (accepted limit 26) |
| no level exceeds its census | drawn without replacement from `level_caps - level_minted`; `mint_vault` and `claim_charter_vault` refuse once `minted_total` reaches the census total (`LevelCapReached`) | **prevented on-chain** |
| nobody chooses the ORDER of draws | `reveal_level` runs strictly in mint order (`RevealOutOfOrder`), because each draw changes the census the next one sees | **prevented on-chain** |
| no level without entropy | `capture_entropy` copies the hashes into the record while they are still in `SlotHashes` (window 300 slots, ~2 min); a lapsed window is RESCHEDULED to a fresh future slot (`reschedule_reveal`, logged `CBOB_REVEAL_RESCHEDULED`), never defaulted (Gary: *"We can't lock everyone in the lowest level"*) | **prevented on-chain**; a lapse is an accepted limit (25) |
| the draw is checkable | the captured entropy is STORED in the vault's record, so every draw can be replayed (L.10) | **publicly verifiable** |

Capture is permissionless and also rides on `mint_vault`, `claim_charter_vault`,
`activate` and `claim` (up to 4 queued records each), alongside the crank's
every-minute lane. A vault burned before its draw still takes one (L.11), so the
FIFO never stops at it.

`reveal_level` must re-send the vault's minted attributes, because Core's
`UpdatePluginV1` replaces the whole list; they are checked against a hash the mint
stored (`AttributesMismatch`). That is why the stored list is bounded at 640
Borsh bytes (`AttributesTooLarge`) and 8 attributes in all, the program's own
included: 7 caller attributes on a paid mint, 6 on a charter claim (which also
carries `charter` = the spent Proof of Burn's address). L.12 proves a vault at the
full budget can still be revealed in a legacy transaction; L.13 and L.14 prove the
program's limit binds. v5's packet squeeze between the deck proof and provenance
went with the deck.

The payout side reads the level from the vault's RECORD (`VaultRecord.level`),
which `activate` requires to be 1..5, so an activated vault always has a level.
v5's whole-payout halt for an unlevelled vault (accepted limit 19) cannot arise.

## Known limits, stated rather than papered over

> **This list holds costs that were CHOSEN.** Unrepaired audit findings live in
> **ACCEPTED LIMITS** below, which is a different list with a different rule for
> what belongs in it. If you are about to add a limit here, ask whether it is a
> consequence of a decision (here) or a defect nobody is going to fix (there).
> Several v6 items appear in both, deliberately, because they are both.

- **The programs are immutable, so every surviving bug is permanent.** That is
  Gary's ruling and the price of "nobody can change the rules". A bug in minting
  can be STOPPED in seconds by the guardian but never fixed; sales then stay
  stopped unless a vote decides the bug is tolerable. A bug in redemption or the
  pool cannot be stopped at all, by design (no stop reaches them). This is why
  the ship gate and the Test Vault simulation come BEFORE the upgrade authority
  is removed (accepted limit 39).
- **The SOL → cbBTC swap is off-chain and trusted.** See the revenue table
  above. The SPLIT is enforced on-chain; the SWAP is not, and cannot be here.
- **A REDEEMED VAULT DESTROYS ITS OWN PROVENANCE ON THE ASSET.** Since v5 every
  redemption burns the vault, so its attributes (provenance, `level`, and in v6
  the `charter` mark naming the spent Proof of Burn) go with it. Asserted at
  6.5/6.6 so a charter member never discovers it instead. What survives is the
  mint transaction, DAS's burnt entry and, in v6, the vault's `VaultRecord`, which
  is never closed and still records its mint index, level and `charter` flag.
  **This is the price of the rule and it is Gary's to pay; it is not a defect.**
- **A vote is atomically rentable.** Transfer the vault to a broker, cast, and
  transfer it back, all in one transaction: the owner signs once, standing holds
  for the slot that matters, and the `VoteRecord` is written. Binding the vote to
  the ASSET stops a vault voting twice; it does not stop the vote being lent.
  Fixing it needs a snapshot of holders, and a snapshot needs somebody to compute
  it and everybody else to trust them — which this design rejects on purpose. So
  it is a stated limit, not a claim of a binding stronger than the property.
- ~~A vault minted during a proposal may vote on it.~~ **(v5, superseded by v6
  stage 2: CLOSED ON CHAIN.)** Each vault's mint index is in its `VaultRecord`,
  each proposal snapshots `minted_total` at creation, and a vault whose index is
  not below the snapshot is refused (`VaultTooNew`). v5 relied on a written Bank
  duty here, and on a second duty, refusing a charter-priced mint not backed by a
  burned Proof of Burn; v6 has no Bank, and the charter claim burns the Proof of
  Burn by CPI in the same instruction while a voted round can never be free.
- ~~`minted_total` never decrements, so `quorum_bps` may be lowered.~~ **(v5,
  superseded.)** v6's quorum divisor is LIVE supply at proposal creation,
  `minted_total - BURN.burned_total - MINT.bare_burns_retired`, and the quorum is
  fixed at `initialize`. A bare-burned vault still counts until someone calls
  `retire_burned`, which can only make a proposal harder to pass.
- **If every vault is redeemed, no proposal can be created until a new vault
  exists** (a proposer must show a live vault). A round still open can mint one;
  once all 2,100 have been minted, or with no open round, that is final, with
  immutable programs and no admin. Red-team 2 finding 7, accepted (accepted limit
  45, corrected in round 24).
- **The 7-day proposal execution deadline is NOT exercised by the test suite**,
  for the obvious reason (it is a constant, not an `initialize` value). Its
  sibling, that a round already over is skipped rather than installed, is tested
  end to end (3c.R1).
- **`--reconcile` cannot be integration-tested locally**: it needs DAS and a real
  cluster, and the test validator has neither. Its JUDGEMENT is a pure detector
  proven both ways; only the I/O is untested, and that is why it is said here.
- **A stranger can make a redemption attempt fail if the sweep moves PRE-READ
  amounts; the redeem page therefore sweeps at execution time (round 23 F1;
  ACCEPTED on chain by Gary 2026-10-04: "that should never matter", and the full
  emptiness check is KEPT; round 24 A3, Gary 2026-10-05: build the sweep
  helper).** A sweep built from amounts read just before sending can be defeated
  by a deposit landing in between (at least 650,240 lamports to the asset-signer
  PDA, mainnet's rent floor for a 0-byte account, measured; 890,880 is the test
  validator's figure; or ONE base unit of any reserve token to its account):
  something is left behind and `burn_vault` refuses `VaultNotEmpty`. An honest
  race does the same: a distribution landing in between makes the redemption's
  own `claim` pay more than a pre-read sweep moves. Each attempt costs the
  griefer a deposit that goes to the victim, but round 24 (A3) measured that a
  retry does NOT clear a persistent griefer: landing one base unit every slot
  (about 0.045 SOL an hour in fees) defeats every pre-read sweep for as long as
  it pays. **THE ANSWER IS A SWEEP AT EXECUTION, `programs/cbob-vault-sweep`**:
  a fifth program of ours, stateless (no config, no key, nothing to initialize),
  to be deployed, verified and locked with the other four. BUILT (round 24; the
  "being built" this said is stale, round 25 D6): byte-identical in `dist/`,
  `target/deploy/` and the localnet build's release output (item 50), and watched by the alarm
  (`prog.sweep.upgrade_authority`, `prog.sweep.hash`).
  The redeem page calls it through Core's `ExecuteV1`, which only the owner can
  sign and in which Core signs as the asset-signer PDA; AT THE MOMENT IT RUNS it
  moves each named reserve account's whole live balance to the owner's account
  for that mint, closes the source (its rent to the owner), and sends every
  lamport the vault wallet holds to the owner, after the `claim` and before
  `burn_vault`, all inside the one atomic redemption. Nothing can land between
  it and the burn, so the exact-amount race is CLOSED for every account it
  names. It names only what exists when the page builds the transaction, so the
  page must make sure all three of the vault's reserve accounts exist first
  (creating any missing one in the prior transaction of item 42): otherwise a
  stranger can create a missing one with dust in between and the burn refuses.
  Called directly it can move nothing (the sources belong to the asset-signer
  PDA, which only Core signs for, and only for the owner). It changes none of
  the four programs: **the program-side emptiness check is unchanged**, cannot
  be dropped (proven impossibility 4), and still refuses a redemption by any
  client that sweeps pre-read amounts, which such a griefer can delay
  indefinitely. The helper is an obligation of item 50. MEASURED since round 24:
  suite arms SR.0-SR.4a (the helper called directly is refused; a destination
  not owned by the named wallet is refused; the exact-amount sweep fails after a
  sat of dust and the helper's sweep of the same race lands) and the Test Vault's
  S8.0-S8.3, where a three-reserve redemption through the helper, claim included,
  is 1,061 bytes and lands after a stranger's deposit. Round 25 (N4, N5):
  SR.6-SR.12a and SR.14 now pin malformed input, wrong programs, destination
  aliasing, foreign/mismatched/duplicate sources and frozen-source refusals;
  SR.13 proves a zero-pair lamports-only sweep. SR.4a checks the exact SOL delta
  including gifts, released rent and fees. S8.0 reserves packet space for both
  compute-budget instructions and a separate payer; S8.1a measured 168,343 CU
  for the four-instruction redemption (item 50).
- **The reserve list is a HARD CEILING of three, measured.** A redemption is one
  transaction (claim, open, every sweep, the burn), so transaction size bounds the
  product. Until round 13 `MAX_RESERVE_MINTS` was **8**, a Borsh bound standing
  where a packet bound was needed: in v5 one ordinary admin `update_config` could
  have added mints until no redemption fit and sealed every vault irreversibly.
  v6 writes the list once at `initialize`, and the bound still guards that write.

  Measured (9.14) by building the **worst-case legacy shape** — every reserve swept AND
  closed, both ATA derivations declared, and the PDA's lamports swept too, because
  a stranger can put lamports in any vault for free (9.10) and the burn refuses
  until the same transaction takes them out (9.11). v5, with the Bank:

  | reserve mints | 1 | 2 | 3 | 4 |
  |---|---|---|---|---|
  | legacy bytes (v5) | 831 | 975 | **1119** | cannot be serialized |

  v6 dropped the Bank's signature and accounts but BURN now also carries MINT,
  MINT's config, the vault record and the pool (it retires the vault by CPI), so
  the three-mint worst case is **1,153 bytes** (9.14a), and it still fits with
  the `claim` an activated vault needs (9.14c; the 1,169 bytes quoted for that at
  stage 3 predates stage 3b's pool account). `MAX_RESERVE_MINTS` is **3** in SEAL and BURN —
  exactly the three reserve assets — and 9.14/9.15/9.15a/9.16 assert that three
  is the most that fits that legacy shape and both constants agree with the measurement, so
  raising one without re-measuring turns the suite red. **A fourth reserve mint is
  not possible under this protocol**: no instruction adds one. The older
  explicit-transfer shape would also exceed the legacy packet. S9b now proves a
  v0 transaction with a lookup table for two three-reserve redemptions;
  the production redemption page remains OPEN (item 50). 9.13a pins the measurement's own foundation — that an unsigned
  serialization already reserves the 64 bytes per signature.

  The explicit-transfer shape above fits only two reserve mints if it also
  creates the redeemer's destination ATAs (9.14b/9.14d). The sweep-helper shape
  measured in S8 is smaller: offline legacy serialization with the owner paying and
  no compute-budget instructions is 1,061 / 1,135 / 1,177 / **1,219 bytes** with
  zero / one / two / three destination ATA creates. That narrow three-create
  variant fits the packet; it has not been landed as a separate test. Adding
  those creates to the fully padded 1,209-byte page shape instead gives 1,367
  bytes, which exceeds the legacy limit. The redemption page must create missing destination
  ATAs in a prior transaction so its compute-budget and separate-fee-payer
  variants fit too; creation need not be atomic with the burn. Missing vault
  reserve ATAs must also be prepared as described below (accepted limit 42).

  **COMPUTE UNITS ARE MEASURED, AND THE FEAR WAS THE WRONG WAY ROUND.** This
  paragraph read "compute units are NOT measured anywhere" for nineteen rounds.
  Measured on the artifact (`meta.computeUnitsConsumed` off landed transactions,
  not a simulation, v5): a plain mint is 58,956 CU / 890 bytes, and the widest pad
  that legacy packet allows is 18 instructions at 73,657 CU, leaving 1.33M of the 1.4M
  cap. At 816.7 CU per padded instruction, exhausting compute would need roughly
  1,700 padding instructions, about 32,000 bytes of transaction. **The byte wall
  binds more than twenty-five times before the compute wall in that legacy shape.** Assertions
  10.1-10.4 pin it on the v6 build, including a deliberately generous 400,000 CU
  regression ceiling. See ACCEPTED LIMITS, item 12/17, DISCHARGED.
- **A PDA owner cannot redeem**, so `mint_vault` and `claim_charter_vault` require
  the owner to sign. This makes bulk issuance to absent members impossible by
  design, and a DAO or multisig cannot hold a vault usefully (accepted limit 43).
- **The upgrade authority is REMOVED at launch** (v6, Gary's ruling: immutable).
  Until it is, whoever holds it could replace a program and "no key can unseal a
  vault" would be false by one indirection; the alarm reports any of the four,
  or the sweep helper (five in all, round 25 D6), still upgradeable past the lock date (the earlier of `lock_deadline` and
  MINT's `charter_opens_at`). (v5's plan was to move it to a
  multisig and keep the Bank key a plain keypair; both are superseded.)
- **METAPLEX CORE IS THE FIFTH PROGRAM AND WE DO NOT CONTROL IT.** Every seal,
  thaw, sweep and burn is a hand-built CPI into Core, whose upgrade authority is
  live and is Metaplex's. `scripts/run-tests.sh` refuses to certify against a Core
  that is not byte-identical to the pinned mainnet dump, and the alarm watches
  `prog.core.upgrade_authority` and `prog.core.hash` in production. It detects;
  it cannot prevent (accepted limit 40).
- **A burned asset address cannot be reused** (measured, 9.12/9.13): Core leaves a
  1-byte tombstone at `Key::Uninitialized`, still Core-owned and still holding
  2,495,280 lamports, and `CreateV2` over it is refused by the System program with
  "account already in use". "Never exists again" is true of the address as well as
  the vault — but it rests on Core behaviour we do not control. The charter claim
  leans on the same fact: a spent Proof of Burn address can never be re-minted,
  so a Merkle leaf can be spent once with no bitmap.
- **`INIT_AUTHORITY` in all four programs is Gary's wallet**
  `Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb` (Phantom, on-curve; v5 used the
  CBOBTC Squads). It signs the one-time `initialize` of each program and nothing
  else. `--features localnet` swaps in a test key so the suite can sign. That is
  the ONE way the tested binary differs from the shipped one, and it cannot be
  checked by inspection: the compiler folds the 32-byte compare into instruction
  immediates and no contiguous run of even 4 key bytes survives in the `.so`
  (measured). `scripts/build-mainnet.sh` therefore deploys BOTH builds to a
  validator and asks each whether it trusts the test key — mainnet must REJECT,
  localnet must ACCEPT — checks the source carries Gary's key, then prints the
  sha256 to deploy.

## ACCEPTED LIMITS — the audit carry list, closed

**Read this before filing a finding.** Twenty-one v5 audit rounds and three v6
red-team passes produced these. Every one was measured or read against the code,
every one is real, and the ones under ACCEPTED are not going to be fixed. A limit
written down before a round is not a finding when that round re-reports it; a
limit left unwritten resets the freeze counter every time a fresh reader notices
it, which is the treadmill `audits/FREEZE.md` exists to leave.

**This section and "Known limits, stated rather than papered over" above are
different lists and the difference is not stylistic.** That one holds properties
of the DESIGN — consequences of decisions taken deliberately, most of them
on-chain and permanent. This one holds unrepaired AUDIT FINDINGS. A defect that
is accepted lands here; a cost that was chosen lands there. Numbering follows
`audits/FREEZE.md` so the two documents can be read side by side, which is why
there are gaps: a discharged item keeps its number rather than letting the list
renumber underneath a reader. v6 items continue the numbering from 25.

**Three states, and an item is in exactly one of them.** ACCEPTED means will not
fix. OPEN AND BLOCKING means it must be done before anything mints and must not
be quietly demoted to accepted — limit 17 sat there for five rounds and was
discharged by measurement, not by argument. DISCHARGED means measured closed, or
removed with the thing it was about, with the reason named, so a later reader can
neither re-report it nor mistake the list for complete.

**v6 moved a whole family of items to DISCHARGED at once.** Items 1a, 1b, 2, 3,
4, 5, 11, 15, 16, 18, 20, 21, 23 and 24 were about the Bank key, its co-signer,
the deck or the off-chain distributor. None of those exist in v6, so the limits
went with them. Each is kept below, under DISCHARGED, with what replaced it.

---

### ACCEPTED — will not fix

#### `bank/lock.mjs` — the mutual exclusion under the money crons

**6. An aborted `flock` run is indistinguishable from one that never fired, in
the log.** *Costs:* diagnosis time after an incident. *Who:* the operator.
*Why not fixed:* it is a logging shortfall, not a correctness one, and every
change to this file in rounds 12, 14, 15 and 16 introduced a defect.

**7. A wedged-but-alive holder is a permanent silent skip under `flock -n`.** A
process that holds the lock and never finishes stops every later run of that
job (the crank, the reveal lane, revenue). *Costs:* our layer of the automation
stops until a human notices. *Who:* holders, through a later payout or reveal.
*Why not fixed:* the alternative — a timeout that steals the lock — is how a
double-send happens. v6 makes the stall survivable rather than silent: every
crank instruction is permissionless and the monthly distribution also runs
in-line in ordinary traffic, and the alarm raises `distribution_overdue` when a
period passes with no distribution and `reveal_rescheduled` when a capture
window lapses. ⚠️ Round 23 (D5, M3, M4): that sentence was UNTRUE for two of the
three jobs until this round. A wedged crank whose distributions traffic kept
running in-line left owed shares undelivered with every detector quiet; it now
pages `crank_silent` (no LIVE full-pass heartbeat in 3 hours while the crank is
armed). A wedged, dead or never-armed revenue job left royalty SOL sitting with
no ledger row and nothing reading the revenue address; it now pages
`royalties_unswept` (a sweepable 1 SOL or more, a day without a sweep). Round 23
(L15) also stopped a DEAD holder blocking a lane: `bank/lock.mjs` breaks a dead
or recycled pid's lock at any age; a live one is still never stolen from. (v5
text named `detectDistribution`'s `distribution_unfinished`, which was deleted
with `bank/distribute.mjs`.) ⚠️ Round 24 (H1, L4): "its failures page from the
crank itself" was true once per stream: every crank page shared one router
label, so the first failure opened it and every later one, of either lane, was
suppressed for 12 hours with nothing to close it. Each crank lane now has its own
stream (`cbob-vault-crank:full`, `:reveal`, `:fee_ceiling`), pages its FULL
failure list, and sends a RECOVERY on its first clean live pass. The alarm no
longer takes the crank's word alone: the heartbeat carries the pass's failures
and problems, and three live passes in a row with failed actions
(`crank_failing`), or one problem in three in a row (`crank_problem`, e.g. an
owed vault left out of every batch), page HIGH; a `crontab -l` that cannot be
read is `crank_posture_unreadable` HIGH and keeps the armed-since clock, where it
used to read as "not armed" and silence `crank_silent`.

#### `bank/alarm.mjs` / `bank/detectors.mjs` — continuous detection

**8. Cross-pass correlation lag.** If the signature walk reaches the burn in a
LATER pass than the DAS diff, the CRITICAL has already gone out and nothing
retracts it. *Costs:* a false CRITICAL that a human must close by hand.
*Who:* the operator. *Why not fixed:* retraction means the alarm editing its own
history, and a pipeline that can un-say a CRITICAL is worse than one that cries
wolf. ⚠️ This item FELL OFF round 16's carry list while still unfixed; the leak
is recorded in the freeze log as one.

**9. (v6 restated, and WIDER than v5) Nothing detects a FOREIGN Core asset nested
in a vault continuously, and since v6 nothing refuses the redemption either.**
In v5, `bank/cosign.mjs`'s `scanPda` asked DAS for every asset the vault's PDA
owned and refused the co-signature, so a foreign nested asset failed the
redemption CLOSED; what was missing was only advance warning. v6 deleted the
co-signer. `detectNestedVaults` walks our own collection and cannot see a
foreign asset, so the only pre-signature check left is the redeem page's
`judgeRedemptionCoverage`, which is not built (item 50), and an owner who
redeems by any other client destroys the nested asset. *Costs:* the asset.
*Who:* the holder, to their own property, except that a nested vault left
activated dilutes every other vault's payouts forever (round 29 D2, see the
note under "What got worse"). *Why not fixed:* the chain cannot
enumerate what a PDA owns (proven impossibility 2), and continuous detection
needs a per-vault DAS owner search every pass. See also item 44.

#### The swap hop (`bank/revenue.mjs`, MINT `sweep_sol_for_swap`)

**10. (v6 restated) The swap operator is the one trusted hop.** Royalty SOL is
swept on chain to a long-lived operator key and swapped to cbBTC off chain; mint
prices are cbBTC and never touch it. *Costs:* the operator (or a thief of its
key) can keep the SOL: per-sweep cap x cooldown windows until the guardian
pulls `emergency_stop_sweep`, never more than the revenue PDA holds above the
reserve. *Who:* holders and the Squads, of royalty revenue only. *Why not
fixed:* there is no trustless SOL->cbBTC without a DEX CPI. **BUYER-FACING** for
what the key can take (in the holder guide's honest list since round 25, D5:
royalty SOL up to the cap every cooldown until the guardian stops it, never a
vault, the pool or sale cbBTC). What v6 adds: the
operator must sign, a vote can only tighten its bounds and only inside the
`initialize` bounds (1 SOL, 24 h, 0.1 SOL ruled), a replacement needs half of
all live vaults (as snapshotted at the proposal's creation) plus 7 days' notice,
and the guardian can stop the sweep and
cancel a pending replacement. ⚠️ ROUND 24 (M1; Gary 2026-10-05: "Orca direct +
Meteora fallback"): THE SWAP NO LONGER SIGNS WHAT A THIRD PARTY BUILT. Until round
24 `bank/revenue.mjs` signed the transaction Jupiter's `/swap` endpoint returned,
checked only by a narrow blacklist (round 23 D3), and round 24 measured that
endpoint's host GONE. `bank/swap.mjs` now builds the swap itself against two
PINNED pools: the Orca Whirlpool `CeaZcx…` (SOL/cbBTC, ~$10M liquidity, 0.16%
fee) first, the Meteora DLMM `H2USRS…` (~$0.9M) only if Orca's program refuses.
Every account is pinned or derived, and both programs' interfaces are from their
published IDLs. ⚠️ ROUND 25 (D1, L1) CORRECTED WHAT THE PRE-SIGNING JUDGE WAS SAID
TO DO. At `2b67fb1` `judgeSwapInstructions` checked only the allowed programs, one
signer, one venue instruction naming the pinned pool, one System instruction whose
second key is our wSOL account, and one close of that account back to us.
Measured, each of these passed it on both venues: the output account changed to a
stranger's, a floor of zero, a changed amount, Orca's direction flipped, a
priority fee appended, a Token `Approve` of our cbBTC to a stranger, a changed ATA
owner, and a 50 SOL wrap. It now takes the cycle's `lamportsIn` and `minSats` and
requires the EXACT seven-instruction sequence `swapInstructions` builds: a
compute-unit limit of 400,000 and no compute-unit price (it refuses a priority
fee); each ATA creation for the operator's own wallet and mint; one System
transfer of exactly `lamportsIn` from the operator into its own wSOL account;
SyncNative; the venue's swap with the operator's wSOL and cbBTC accounts at their
pinned positions, its amount `lamportsIn`, its threshold `minSats` and, for Orca,
the direction and price limit pinned; and no Token instruction but SyncNative and
the one close (`bank/swap.mjs` `judgeSwapInstructions`; selftest round-25 L1 arms refuse each of the verdict's eight tampers on both venues). **What a judge in this tree can and cannot
catch:** it lives in the same file tree, under the same user, as the builder and
the signing key, so it catches OUR defects, never a tampered module (whoever can
edit `bank/swap.mjs` can edit the judge, or `bank/revenue.mjs`, which holds the
key: the box-owner residue in (3) below). A builder defect that misroutes the
output or drops the floor is also caught AFTER signing: `bank/revenue.mjs` throws
when the operator's cbBTC delta is below the floor, and the cycle stays open and
loud.
The OUTPUT FLOOR is enforced ON CHAIN by the pool program and comes from Pyth (the
sponsored, fully verified SOL/USD and BTC/USD accounts: at most 180 s old,
confidence within 0.3%, `MAX_ORACLE_CONF_BPS = 30` since round 25 I3; the live
confidence is about 1.5 bps), never from the pool's own price. A pool whose spot
price is more than 1% from the oracle at either market read is skipped. This
read-time filter does not bind the price at execution; the transaction enforces
the separate 150 bps output floor. The price's age is judged against the
chain's Clock sysvar, never the box clock; an unreadable Clock refuses the cycle,
and a `publishTime` more than 30 s ahead of it is refused (`oracleFloor`,
`market()` in `bank/swap.mjs`; selftest round-25 L2 arms, fork arms SW.7-SW.7b). (Round 25 L2:
at `2b67fb1` the age was judged on the box clock, which round 24 I2 had already
taken off the crank, so a box running slow accepted a stale price, and a
future-dated price passed.) **The bound, as a number:** the output floor is the
oracle-derived expected output less 150 bps (`SWAP_TOLERANCE_BPS`), rounded down
to whole sats. Each USD feed's reported confidence must be at most 0.3% of its
reported price (`MAX_ORACLE_CONF_BPS = 30`). These checks do not establish a hard
bound on deviation from the true SOL/cbBTC market price. Confidence measured on
2026-10-05 was 1.5 bps for SOL and 1.0 bps for BTC. Proven on a mainnet fork (`sim/swap-fork.sh`, a
`run-tests.sh` gate): real swaps through both real programs against cloned real
pool state, and a floor 5% above the oracle refused by each program with nothing
moved.
**What remains trusted** (round 25 D1: this list named only the first item):
(a) the two pool programs and the Pyth price (a stale or manipulated oracle is
bounded by the age, confidence and pool-agreement checks, not removed); (b) THE
ONE RPC ENDPOINT every price, pool account and floor is read through; (c) the
integrity of `bank/swap.mjs` and `bank/revenue.mjs` themselves, which no check in
the same tree can vouch for; (d) THE THIRD PARTIES' UPGRADE KEYS, all live and
none ours (round 25 I2, read on mainnet 2026-10-05): the Orca Whirlpool program
`whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`, upgradeable by
`GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV`; the Meteora DLMM program
`LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`, by
`JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd`; and Pyth's receiver
`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` and push oracle
`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, both by
`6oXTdojyfDS8m5VtTaYB9xRCxpKGSvKJFndLUPV3V3wT`. Whoever holds any of them can
replace the program the swap or its floor runs on. The alarm watches each one's
upgrade authority and bytes, at HIGH rather than CRITICAL because their upgrades
are routine; it detects, it cannot prevent (`THIRD_PARTY_PROGRAMS`, `bank/detectors.mjs`).
**Throughput has a permanent ceiling; the alarm observes net balance changes**
(round 25 A2, qualified in round 27). The ruled cap, 10 SOL per 6-hour cooldown, can only be lowered by a vote, so
royalty SOL beyond about 40 SOL a day waits in the revenue address however large
the backlog, and `detectUnsweptRoyalties` restarts its clock on every fall of the
balance. A capped sweep resets that clock only if the balance falls between
alarm reads. Incoming royalties can hide a successful sweep, so the clock can
continue and page even while sweeps work; inspect the transactions and ledger.
Round 25 (L4): at
`2b67fb1` the revenue cron ran at `41 */6` while `last_sweep_at` is the chain time
the sweep LANDS, a few seconds after the run starts, so the next run usually read
the cooldown as not yet elapsed and skipped: 20 SOL a day in practice. The job now runs HOURLY
(`41 * * * *`, `scripts/cron-install.sh`) and judges the cooldown on the chain Clock
(`sweepCooldownOver`), so it sweeps on the first run after the cooldown truly
elapses; the alarm's `royalties_unswept` grace now follows the on-chain cooldown.
**Hand recovery of an open cycle** (round 25 A3). `bank/revenue.mjs` refuses to
start a cycle while one is open and says to resolve it by hand (`--audit` lists
them); the automatic path cannot double-swap, the hand path can. Live failures use stable `cbob-revenue:<stage>` streams; only a stage actually passed can send its saved recovery, and failed notification delivery keeps its marker. Before swapping
by hand, look up every recorded confirmed or candidate signature with `getSignatureStatuses(...,
{ searchTransactionHistory: true })` and read the operator's wSOL and cbBTC
balances. Round 26 preserves known uncertain-send candidates as `pendingSweepSig`,
`pendingSwapSig` (and `pendingSwapVenue`), `pendingReturnSig` and `pendingSplitSig`;
these are evidence to investigate, not confirmation or permission to retry.
A swap whose confirmation timed out may have landed, and a second swap would
then be a double swap. Check the return and split before repeating either too.
Record the hand return in the ledger and re-run
`--audit` until it is clean.
⚠️ Round 24 (D2), still true: (1) THE OPERATOR WALLET must hold nothing but the
cycle's funds and its fee float; nothing on chain enforces that. (2)
`OPERATOR_FLOOR` IS the 0.02 SOL float and nothing refills it: fund it above the
floor and top it up by hand. (3) The DETECTION half does not survive a
compromise of THIS BOX: the revenue ledger, the crontab and the alarm belong to
one user, so whoever can write the ledger can also stop the alarm. Round 24 (L10)
holds the ledger to the chain wherever the alarm can (a sweep under a row marked
refused, an explicit split held to the same total-and-order anchor as a
`splitByOther` one, a verification horizon that follows the sweeps the scan saw,
start times capped by the sweep's block time),
which catches an off-box key thief and honest mistakes, never the box's owner.


#### MINT

**13. (v6 restated) A level is immutable only as far as MINT's upgrade authority
is trustworthy, until that authority is removed.** In v6 the Attributes
plugin's authority is MINT's `["mint"]` PDA, and the only instruction that writes
attributes after `CreateV2` is `reveal_level`, once (`AlreadyRevealed`). 11.13
and 11.14 assert that neither the owner nor the `INIT_AUTHORITY` can rewrite a
drawn level (Core refuses), and 11.15 that the drawn value survives. The
reserved `redemption` key is still refused at mint, though nothing has written
it since v4. *Costs:* until the upgrade authority is removed, whoever holds it
could ship an instruction that rewrites any vault's level, which decides how
much every holder is paid. *Who:* every holder. *Why not fixed:* it is closed by
removing the upgrade authority at launch (ship gate), and the alarm reports any
program still upgradeable past the lock date (the earlier of `lock_deadline` and
MINT's `charter_opens_at`, round 23 L12). **BUYER-FACING.**

#### v6 stage 3 — the draw, the pool, and what they leave

**25. A MINTER WHO DISLIKES THEIR DRAW CAN LET IT LAPSE FOR A RE-ROLL — BUT ONLY
IF NOBODY CAPTURES IT FOR THE WHOLE WINDOW.** Slot hashes are PUBLIC, so once a
vault's three hashes exist anyone can compute its draw off chain without
capturing it (stage 2's comment saying the minter "cannot see the draw without
capturing it" was wrong). Since stage 3 a missed window is RESCHEDULED to a fresh
future slot (Gary: *"We can't lock everyone in the lowest level"*), so a minter who
computes a bad draw and declines to capture gets a new roll — PROVIDED no one else
captures in the ~300-slot (~2 min) window. *Costs:* one re-roll per full window of
total silence; repeated silences are repeated rolls. *Who:* every other holder,
through the census (a re-rolled Level V is a Level V someone else did not draw).
*Why not fixed:* any rule that assigns a level WITHOUT entropy (stage 2's
lowest-level default) punishes holders for a crank that did not run, which Gary
ruled out. ⚠️ Round 22: traffic captures nothing unless it NAMES the record, so a
lapse needs only that nobody who names this record sends a capture, and both the
crank operator and the minter's own client can withhold one. *The control:*
capture is permissionless and rides on `mint_vault`,
`claim_charter_vault`, `activate` and `claim` (up to 4 queued vaults each), the
crank's reveal lane runs every minute, and **every reschedule logs
`CBOB_REVEAL_RESCHEDULED`** and counts on the record (`reschedules`), so the alarm
pages on a reschedule. ⚠️ **ROUND 22 CORRECTED THIS:** it used to say a lapse
"needs a crank outage AND no protocol traffic". That is false: capture accounts on
the host instructions are OPTIONAL (most traffic carries none), and a crank that
is up but slow (it confirms each capture serially) also lapses windows in a burst.
⚠️ Round 25 (A1) measured how little "slow" takes: one RPC socket that accepts and
never answers. web3.js 1.98.4's default `Connection` (the crank's and revenue's at `2b67fb1`)
waited 300.8 s before failing, longer than the whole window, and the next minutes'
`flock -n` runs skip silently meanwhile (item 6).
And a window that lapses with NOBODY calling reschedule logs nothing at all, so
the alarm now also pages when the level queue does not move between two passes
(`reveal_queue_stalled`). **BUYER-FACING** (in the holder guide's honest list since
round 25, D3, which also deleted its "Nobody else can").

**26. THE LEADER OF THE LAST ENTROPY SLOT CAN STILL GRIND ITS OWN BLOCK.** The draw
hashes three slot hashes from three different leader rotations (A at or after the
reveal slot, B and C each two 4-slot groups later; alignment measured on mainnet).
That removes every other leader's influence, but C's leader produces its block
KNOWING hA and hB and may vary its contents. ⚠️ Round 22 corrected "(or skip,
handing C to the next leader)": B and C target the FIRST slot of a 4-slot leader
group, so a skip by C's leader moves C to that SAME leader's next slot, and the
leader schedule is public, so a validator can time a mint (or a reschedule) to
put C inside its own rotation. Being C's leader is chosen, not a stake-share
lottery. *Costs:* a validator that is C's leader can CHOOSE AMONG MANY DRAWS, not
merely bias one. ⚠️ Round 24 (A1): C is the smallest produced slot in
`[want, want + 64]`, so the leader can skip its own first slot(s) and move C
within its own 4-slot group; skipping alone is best-of-4, which takes P(Level V)
from 5.0% to 18.6% and the expected weight from 3.05 to 4.38 (against the
945/525/315/210/105 census), and varying its block's contents adds more (64
tries reach 96%). For its own vault, or a cohort's, it is selection within the
levels still left, not a nudge. And ⚠️ (round 22) **not just one vault's**: every
vault minted in the same slot shares the same `reveal_slot`, so the same three
hashes, so C's leader chooses for that whole cohort at once (each vault still
mixes its own asset address into the hash, so one choice serves the cohort
jointly, not each vault separately). *Who:* the census, as in 25. *Why not fixed:* the last
contributor to any public-hash scheme can always do this; only a VRF (a program we
do not control) answers it. One validator was measured holding two adjacent
rotations, so "three different leaders" is likely, not guaranteed. **BUYER-FACING.**

**27. A claim between a BARE burn and its retirement pays into a dead account, and
a join adds dead weight.** A vault its owner bare-burns through Core keeps its
weight until anyone calls `retire_burned`. A `claim` in between pays that vault's
own share into its cbBTC account behind the burned asset, where nothing can ever
sign for it; and a bare-burned vault still WAITING to join can be joined by a
`claim` that names it, adding weight nobody can collect until it is retired
(red-team 3 finding 2). `claim` does not check that the asset is alive.
*Costs:* that vault's own share since the last claim, and a sliver of every
other vault's share while the dead weight sits in the denominator. *Who:* mainly
the owner who burned it. *Why not fixed:* refusing it needs the asset account in
every claimed pair (a third account per vault, a third smaller batch). The crank
never pays or joins a positively burned vault and retires it first, every pass;
`retire_burned` returns whatever was not yet claimed to the pool. A boosted
vault's dead weight is larger by its boost, up to +12 (round 23).

**28. Coinbase can freeze cbBTC accounts, including the POOL.** A frozen VAULT
account is skipped by `claim`, logged (`CBOB_CLAIM_DEFERRED_FROZEN`) and stays owed
in full (P.18), and ⚠️ (round 22) it also blocks that vault's WHOLE redemption,
its $GARY and $GIRAFFISH included: BURN requires every reserve account empty and a
frozen account cannot be emptied. The alarm pages `vault_account_frozen` (it reads
every reserve account's state each pass). A frozen POOL stops every claim that
pays until it is thawed. ⚠️ Round 24 (D4) corrected "(joins still go through)":
`claim` never checks the pool for a freeze, so a claim that pays anything reverts
WHOLE at the pool `Transfer`, the joins and expiries in it included; a join goes
through only in a claim that pays nothing (the crank sends join-only batches).
The same holds inside a redemption: one that carries a paying `claim` during a
pool freeze reverts, so the redemption must leave the `claim` out ("REDEEMING A
VAULT", item 50). ⚠️ Round 23: a frozen CBOBTC Squads cbBTC
account halts `split_revenue` too, because both halves move in one instruction,
so the holders' 85% waits in the revenue address (not lost) until it is thawed.
A frozen REVENUE address cbBTC account does the same and also refuses every paid
mint and swap return into it (round 23, L9): the alarm pages
`revenue_account_frozen` at any balance and the crank reports it instead of
splitting into the refusal. Since stage 3c
(red-team 3 finding 1) it no longer locks any vault: a redemption with the pool
frozen lands and FORFEITS its undelivered share back to the pool (logged
`CBOB_REDEEMED_POOL_FROZEN`, 3c.F0-F3), and the in-line monthly run never credits
from a frozen pool. *Who:* every holder, and a redeemer during a pool freeze loses
whatever was credited to their vault and not yet delivered. *Why not fixed:*
nothing on Solana can prevent an issuer's freeze; it is the trust cbBTC itself
carries. Anyone could try to provoke a freeze by sending tainted cbBTC to the
pool. **BUYER-FACING** (the holder guide states it).

**29. Only cbBTC splits.** The pool pays vaults in cbBTC, so `split_revenue`
refuses any other token; anything else sent to the revenue address stays there
for ever (no instruction moves a non-cbBTC token out of it). v5 could split any
token to a distributor wallet able to swap it.

#### v6 stage 3b and 3c: what a vote can reach, the rate limit, and the trigger

**32. The redemption rate limit queues honest holders too, and can be spent by
someone redeeming their OWN vaults.** At most `ceil(2.1% x live)` (floor 1)
redemptions in any rolling window, whoever signs: in a rush, self-custody holders
wait in the same line as everyone else (45 per hour at 2,100 live vaults). An
attacker holding vaults can spend an hour's budget only by redeeming those
vaults, each of which is burned, so blocking one hour costs about 2.1% of live
supply in vaults. A bare Core burn is not a redemption and is not limited (it
releases nothing). The window is an `initialize` value; ⚠️ **mainnet MUST be
3600**. Stage 3c replaced stage 3b's token bucket (which let 2x the cap through
in one rolling hour, red-team 2 finding 4) with a ring of the last 64 redemption
times: RL.2 lands exactly the cap against an empty window, RL.3 is still refused
60% of a window later, RL.4 lands once the window has rolled past, and RL.7
replays every redemption BURN remembers and finds no window over the cap. The
ring bounds the cap at 64, which covers live supply up to 3,047; above that the
limit is stricter, never looser. Round 24 (D8): "live" here is minted minus
redeemed minus RETIRED bare burns, so a vault bare-burned through Core counts
until the crank retires it (within the hour, or by anyone's `retire_burned`),
and for that while the cap can read one higher than the true live supply. Proven at a short window; the 3600 s value is
the same arithmetic, not separately exercised.

**34. Ordering is per KIND, and says nothing across kinds.** A later executed
round, guardian change or operator arm supersedes an earlier one of the same kind,
and since stage 3c the earlier one is SKIPPED and logged `CBOB_ACTION_SKIPPED`
rather than refused, so it cannot take its bundle down (7.26, E.2, red-team 2
finding 6). Different kinds execute in whatever order executors choose (RT1.2); a
stale restart half is skipped by stop time (3b.S1, mirroring MINT's
`StopIsNewer`) and `tighten_sweep` is monotone, so neither needs ordering.

**35. (v6 restated) The 10% turnout rule never binds at the ruled numbers.** YES
must reach 10% of the snapshotted live supply (D.1). With Gary's quorum 21% and
threshold 51% the smallest passing vote is already 10.71% YES, so the turnout
rule only matters if `initialize` is given other values. It stays as a floor for
that case.

**36. The in-line monthly run is skipped by a host that is early, sees an empty
pool, finds an eligible vault still waiting to join, or finds a DUE $CBOB boost
(round 23: `claim` runs the month before it expires; the next host runs it), and a month with NO
protocol traffic distributes nothing until someone calls `distribute` or the next
host lands.** "Programmatic" means any ordinary instruction does it; it does not
mean a clock fires it. The crank is layer one; the alarm pages
`distribution_overdue`.

**37. Every host instruction carries the pool (one more account).** Measured
costs are in the suite (9.14a/9.14c, P.33, 3c.P1). The redemption carries it
through BURN into `retire_redeemed`. A charter claim with an Oracle pass-through
fits only without a crank attached, so the claim page must send no crank when
`pob_extra > 0` (red-team 3 finding 7).

#### v6: what we rest on, and what immutability locks in

**39. Immutability makes every surviving bug permanent.** Once the upgrade
authority is removed nobody can fix anything. A minting bug can be stopped by the
guardian (and then sales stay stopped unless a vote accepts the bug); a bug in
redemption, the pool, governance or the charter claim cannot be stopped at all.
*Who:* everyone. *Why not fixed:* it is the ruling ("Nobody, including us, can
change the rules"). The answer is the order of operations: ship gate, Test Vault
simulation and mainnet dress rehearsal all pass BEFORE the authority is removed.
**BUYER-FACING** (in the holder guide's honest list since round 25, D5).

**40. Metaplex Core is upgradeable by Metaplex.** Every seal, thaw, sweep, burn,
Execute and level write is a CPI into Core. A Core upgrade that changes
`UpdatePluginV1`, `ExecuteV1`, `BurnV1` or the plugin rules reaches every vault,
and our immutable programs cannot adapt. ⚠️ Round 24 (A5) names two concrete
consequences: MINT proves a burn only by Core's exact 1-byte `Key::Uninitialized`
tombstone, so a Core change to it makes every redemption refuse `NotBurned` (in
`retire_redeemed`) and `retire_burned` likewise; and nothing advances
`revealed_total` without a successful Core `UpdatePluginV1`, so a Core change
that breaks it halts the level queue (no later vault can be revealed or
activated). ⚠️ Round 25 (N3) names a third: **who may act through a vault's
wallet.** The sweep helper's whole access control is Core's `ExecuteV1`
authority rule on a THAWED vault. Read at Core `e72d63e` (the source is not
proven identical to the pinned binary): the asset approves Execute only for
`authority == owner` (`state/asset.rs` 325-337), the collection abstains
(`state/collection.rs` 294-301), and the one plugin route that approves anyone
else is the AgentIdentity external adapter with an `ExecutionDelegateRecordV1`
(`plugins/external/agent_identity.rs` 127-138, `processor/execute.rs` 106-118).
Adding that adapter needs the collection's update authority, MINT's PDA, and our
programs' only Core CPIs are the create, the Royalties plugin at `initialize`,
the Attributes update, and the burns (MINT, BURN) plus SEAL's thaw. So it is
sound today, and a Core change to that rule would widen who can empty a vault
during its redemption. MEASURED against the pinned Core binary: SR.5 and SR.5a
refuse a stranger and an owner-added transfer delegate on a genuinely thawed
vault (`NoApprovals`, 0x1a); SR.5b pins the collection authority to MINT's
off-curve PDA. On a control asset, SR.5c refuses the collection update authority
with the same reason and SR.5d lets its owner sweep the wallet to zero. SR.5e
checks that the refused vault attempts preserved its balances, owner and seal.
*Why not fixed:* not ours. The alarm watches
`prog.core.upgrade_authority` and `prog.core.hash`; it detects, it cannot
prevent. **BUYER-FACING** (round 25 D5: the holder guide's honest list now
names all three consequences).
⚠️ Round 28 validation, a MEASURED Core size boundary. The pinned Core runs each
instruction in a fixed 32 KiB heap; a requested larger heap frame does not help
it. An owner may add the owner-managed Autograph plugin, and any signer may then
add their own signature. With a 10,150-byte message on the FIFO-head vault beside
all five owner-managed plugins, the actual MINT reveal landed (R28.A1, R26.P6).
Afterwards Core could not shrink that real vault: clearing the signatures
(R28.A2) and `RemovePlugin` of even the small FreezeDelegate (the first round-28
full-run attempt, `.cache/r28-first-onchain-failed.log`) exhausted the heap and
reverted. So the owner cannot remove ANY owner-managed plugin from it, including
a delegate they approved. On that same real vault the owner freezes still thawed
(R26.P7); a transfer (R28.A3) and the complete redemption transaction, SEAL open,
Execute sweep of its funded cbBTC and BURN (R28.A4), both succeeded as
simulations, leaving it unchanged; and the vault then completed activation,
claims and votes in the suite. An isolated probe on a simpler asset shape
(`.cache/r28-recovery-probe.mjs`) also refused a stranger's further signature for
heap. Near this boundary the asset's shape decides the outcome, so these are
bounded observations at the pinned binary, not a proof for every plugin shape or
size combination. *Why not fixed:* Core's allocator and Autograph rules are not
ours. **BUYER-FACING** (holder guide, things to know before you open).

**41. A leaked custodial key is bounded only by the 2.1%/hour REDEMPTION cap, and
transfers are not limited.** The cap was built so that if Gary Club custodial
keys leaked, a thief could not empty every vault faster than we could move them
to fresh keys. It does that for redemptions. A thief holding the keys can instead
TRANSFER every vault to their own wallet at once, then redeem at the cap, or simply
keep or sell them (red-team 2 finding 4). *Who:* custodial holders. *Why not
fixed:* Gary kept the cap (RT2-4) for what it does bound, and an unlimited
transfer is also what lets custodial vaults be moved to fresh keys. The holder
copy must not claim the cap stops a key thief. **BUYER-FACING.**

**42. The redemption page must prepare missing destination ATAs in a PRIOR
transaction.** This keeps the fully padded legacy shape, including compute-budget
instructions and a separate fee payer, within the packet limit: adding all three
creates to its 1,209 bytes gives 1,367. The narrower owner-payer helper shape
without compute extras serializes to 1,219 bytes with all three creates, so the
old categorical “only two fit” claim was false (round 26 D4). That narrow variant
is an offline size measurement, not a landed transaction or the page contract.
*Who:* the required redemption-page client. *Why not fixed:* prior preparation
supports its required legacy shapes without depending on the narrow exception.
This is the current client contract, not an impossibility across all formats.

**43. An off-curve owner (a DAO, a multisig, a program) cannot redeem.** The
pairing needs the owner's signature on two top-level instructions, which a PDA
cannot give. Round 23 (F8) MEASURED the wrapper shapes with a test-only CPI
forwarder (`tests/cpi-wrapper`, its own workspace, deployed only to the suite's
validator): `retire_redeemed` through it refuses `NotFromBurn` (WR.1); a real
open with a wrapped burn refuses `NoTerminalBurn` (WR.2); a wrapped open with a
real burn refuses `NoPrecedingOpen` (WR.3); and the vault stays live with
everything it held (WR.4). ⚠️ Round 22 corrected "nothing on chain can refuse an off-curve
owner at mint": `is_on_curve` panics on BPF, but requiring `mint_vault` to be a
TOP-LEVEL instruction (the stack-height check `retire_redeemed` already uses)
would force the owner to sign the transaction, which only an on-curve key can.
The cost is that no program could mint a vault by CPI. Not built; an owner
decision, and only possible before the lock. The alarm reports any vault owned off-curve as
`unredeemable_owner` at CRITICAL; a marketplace escrow can look the same and is
recoverable. **BUYER-FACING.**

**44. Undeclared airdrops and nested vaults are DESTROYED on redemption.** The
three reserve assets are checked on chain every time; anything else a vault's PDA
holds and the burn is not shown dies with the asset (9.5/9.6, 9.9). ⚠️ Round 25
(D7): narrower than that for CLASSIC SPL tokens. The sweep helper moves any
classic token account the vault PDA owns, of any mint, ATA or not, when the page
names it with a destination account of the same mint owned by the destination
wallet (`programs/cbob-vault-sweep/src/lib.rs`, the pair checks), and closes it.
So `judgeRedemptionCoverage`'s list of stray classic token accounts can be a
SWEEP LIST rather than only a warning (the redeemer's destination account for
each mint must exist first, item 42). Not covered: Token-2022 accounts (the
helper reads only 165-byte classic accounts), a frozen stray account (its
transfer reverts the redemption), and nested Core assets. In v5 the
Bank refused such a redemption; in v6 only the redeem page's
`judgeRedemptionCoverage` can warn before the owner signs, and that page is not
built (item 50). Post-hoc, the alarm reports undeclared token accounts daily
(`--reconcile`) and nested vaults every pass. *Who:* the holder, to their own
property, and, for a nested vault left activated, every other vault's payouts
forever (round 29 D2, under "What got worse"). **BUYER-FACING** (the holder guide tells holders to send only the three
reserve assets).

**45. If every vault is redeemed, governance cannot act until a new vault
exists** (a proposer must show a live vault, and nothing else can create a
proposal). Red-team 2 finding 7, accepted: with no vaults there is nothing left
to govern but sales, and immutable programs with no admin cannot be rescued.
⚠️ Round 24 (D3) corrected "can never act again": `mint_vault` needs no live
vault (MINT lib.rs 1083-1089), so a round still open, under its cap, with sales
not stopped and the lifetime supply not reached can mint one, and its holder can
then propose. Once all 2,100 have been minted (`minted_total` counts redeemed
vaults too), or with no open round, it is as stated.

**46. The Giraffish Moments collection's update authority is a HOT wallet, kept by
ruling, and through the 7-day charter window it can END THE PROJECT BEFORE IT
STARTS or CAPTURE ALL OF GOVERNANCE.** A Proof of
Burn is one of 240 assets in that shared collection, and its update authority is
the Gary Club inventory hot wallet (Gary, RT2-1: "we keep it and it will stay
secure"). Whoever holds it can add an external plugin that Core consults on every
burn. Mitigations that shipped: `claim_charter_vault` passes up to 8 extra
accounts through to Core's burn of the Proof of Burn (never as signers), so a
benign or approving hook cannot brick the claim (tested against a real Core
Oracle plugin), and the alarm pages on ANY plugin or update-authority change on
that collection. Round 23: Core refuses a PermanentBurnDelegate or
PermanentTransferDelegate added after creation (each validates its own add) and
refuses owner-managed plugins on a collection, and the LIVE Moments collection
was read 2026-10-04 to carry only its royalties plugin. Moving a Proof of Burn
out of the collection is the same brick class as a rejecting hook. Packet: in the
widest claim shape (separate payer, two compute-budget instructions, a depth-8
proof) at most FOUR distinct extra accounts fit a legacy transaction (measured
offline: 4 = 1,213 bytes, 5 = 1,246); keeping eight in legacy requires omitting
the separate payer and compute-budget instructions. v0 with a lookup table is
another client option; these legacy measurements do not establish a v1 limit.
⚠️ Round 22: the alarm watches the COLLECTION account, not each
of the 240 assets, so a plugin added to an individual Proof of Burn is not paged.
The hot update-authority wallet can add update-authority plugins or external
adapters; owners can also add owner-managed plugins, including a freeze
delegate that can block the burn while frozen. These per-asset changes share
the same alarm blind spot.
⚠️ Round 25 (D8), two bounds this item omitted. (a) THE ALARM SAMPLES STATE: it
compares the collection's plugins and update authority once a pass (every 30
minutes), so a hook added and removed again between two passes leaves no diff
and is never paged. (b) THE POSITIVE BOUND: that key cannot transfer or burn an
individual Proof of Burn. Core's asset approves a transfer or burn only for its
owner and the collection abstains (`state/asset.rs` 271-296,
`state/collection.rs` 240-258; the owner-managed delegates need the owner), and
it refuses a PermanentTransferDelegate or
PermanentBurnDelegate added after creation (each rejects its own add, Core
`e72d63e` `plugins/internal/permanent/permanent_*_delegate.rs`), so what the key
can do is gate or brick claims, as below, never take a Proof of Burn.
⚠️ **What remains, stated in full (round 24, A2; Gary 2026-10-05: "Keep it hot,
document it", reaffirming RT2-1).** The charter claim is the ONLY way a vault can
exist without a vote: `create_proposal` needs a live vault owned by the proposer
(GOV), and `mint_vault` needs a round (`round_id > 0`, `NoRound`), which only a
GOV proposal can set. So during the 7-day charter window whoever holds that key
can: (1) **END THE PROJECT BEFORE IT STARTS**: add a plugin that REJECTS every
charter claim and hold it through the window. No vault would exist, so no
proposal and no sale round could ever happen, and the window can never reopen.
(2) **CAPTURE GOVERNANCE**: add a plugin that admits only Proofs of Burn they
hold (on the collection, on individual assets, which the alarm does not watch, or
by flipping the oracle between transactions). Their vaults would then be the
whole electorate, and half of all live vaults would be theirs alone: guardian and
swap-operator changes (and with the operator, royalty SOL), sale rounds and
prices down to the floor, and the $CBOB boost terms. After the window closes
`claim_charter_vault` refuses by clock alone and this exposure ENDS (a captured
electorate, once formed, does not). Gary keeps the key hot by ruling (RT2-1,
reaffirmed 2026-10-05); holding it cold or in a multisig through the window
would close it. *Who:* every charter member, and the whole project.
**BUYER-FACING** (in the holder guide's honest list since round 24).

**47. A stolen guardian key can hold sales and the sweep shut for a vote plus a
week at best, and FOR GOOD while fewer than half of all live vaults vote to
replace it.** The guardian can only stop, so a thief can stop sales
and the sweep, and stop them again after every restart vote, and cancel any
swap operator a vote arms. It cannot touch a vault, a payout or a rule. The cure
is a vote that replaces the guardian: YES from half of ALL live vaults (live when
the proposal was created; vaults minted during the vote can neither vote nor
raise the bar, round 25 D1), never bundled with a swap-operator change, landing only after 7 days' notice, which the
guardian in office cannot cancel. *Why not fixed:* that delay is what stops a
captured vote removing the brake in one breath (red-team 2 finding 2). A guardian
of `None` is legal, so the holders can also retire the brake by the same rule.
⚠️ Round 24 (A4): "a vote plus a week" assumes the replacement PASSES. It needs
YES from ⌈50% of ALL live vaults⌉ at creation (GOV `execute_proposal`,
`KeyChangeNeedsHalf`), not of votes cast, so at turnout below that the thief
keeps the key and re-stops after every restart: the stop is then PERMANENT. No
funds are lost; redemption, activation, distribution and claims are never
affected by either stop. Operational note: the guardian wallet is also
`INIT_AUTHORITY`, which signs only the one-time `initialize`.

**48. The charter claim cannot be stopped.** By ruling ("no pause during that
round") `claim_charter_vault` does not read the sales stop, so a bug in the
charter path runs for the whole 7-day window. *Why not fixed:* a stop there could
cost a charter member their claim for good, because the window can never reopen.

**49. A vault's record rent is not refunded.** Each vault's `VaultRecord` (221
bytes, 2,429,040 lamports, paid by the minter) is never closed, by design (see
"The community pool"). DESIGN-v6 once promised a refund; red-team 2 finding 7
caught it and the design was corrected rather than the code.

**55. A vault that joins can share revenue that was still UNSPLIT when it asked**
(round 22, F1; ACCEPTED by Gary 2026-10-04). cbBTC in the revenue address that
has not yet been split into the pool is not part of the distribution that makes
a waiting vault eligible, so one transaction that joins it, splits and
distributes lets it share that balance. It costs 200 $GARY (two burn-path
distributions), or ⚠️ (round 24, D1) as little as 100 $GARY at the monthly
boundary, where the first of the two can be the free `distribute(false)` (MINT
lib.rs 1637-1642) or a host's in-line monthly run; plus a funded, revealed vault.
The crank splits every pass, so
the balance at stake is about an hour of sales WHILE THE CRANK RUNS (round 23:
nothing bounds it on chain, so during a crank stall it grows for the same
$GARY; `revenue_unsplit` pages). Closing it would mean splitting
inside every activation and distribution on chain: more code under the lock for
a bounded, costly edge. Written into the holder guide's honest list.

**56. THE WHOLE $CBOB SUPPLY SITS ON A HOT KEY ON THIS BOX** (round 23, L17;
custody RULED by Gary 2026-10-04: "A new dedicated release wallet"). All
2,100,000,000 $CBOB were minted into the release wallet `AT2qf412…`, whose secret
is `bank/keys/cbob-release.json` (mode 600, in the nightly R2 backup), generated
on this box by `launch/create-cbob-token.mjs`. *Costs:* anyone who reads that
file, on the box or from a backup, can move every $CBOB not yet released: sell
it, or burn it to boost vaults they own, each by up to +12 weight (more than any
level's 2 to 6) for up to 24 distributions, the ruled ceilings, at whatever terms
a vote has switched on. The mint itself is safe (no mint and
no freeze authority, so nobody can print more or freeze anyone). *Who:* every
$CBOB holder, through the price, and every vault holder, through boost-weighted
payouts. *Why not fixed:* the ruling keeps the supply in a dedicated release wallet
the Bank releases from. The custody is recorded and pinned
(`launch/mainnet-init.json` `cbob_release_wallet`, refused by
`scripts/check-launch-params.mjs` if it changes); moving it to Gary's own wallet
or a Squads, and deleting the box key, would close it and is Gary's call.
**BUYER-FACING** (in the holder guide's honest list since round 25, D5).

### OPEN AND BLOCKING — not accepted, must be done before anything mints

These are the ones nobody may write "accepted" against. Limit 17 lived here for
five rounds and left by being measured, which is the only exit.

**22. (v6 restated) NOTHING HAS EVER RUN A DISTRIBUTION AGAINST A LIVE CHAIN.** v6
moved payment on chain (`distribute` + batched `claim`), and the job that sends
those instructions is now `bank/crank.mjs` (installed DRY-RUN), not v5's
`distribute.mjs`. The programs' arithmetic is proven in the suite and the Test
Vault simulation, both on a local validator. The crank's own I/O against a live
cluster with ~2,100 vaults (cost, rate limits, paging, a transient RPC error on
vault 1,900 of 2,100, the every-minute reveal lane keeping up) is not. **This must
be exercised (the mainnet dress rehearsal) before it pays anyone.**
⚠️ Round 25 (L5): NOR HAS THE REVENUE CYCLE, BY ANY GATE. `bank/revenue.mjs`'s
sweep, re-price, venue loop, return, split, ledger writes and recovery run in no
suite, sim or fork (`scripts/run-tests.sh` never invokes it, and its selftest arms
read its source), and this item used to scope the rehearsal to the crank and the
alarm. The dress rehearsal (road step 8) therefore passes or fails on these NAMED
items, each recorded with its transaction signatures:
  1. the crank's live passes against the rehearsal deployment, as above;
  2. the alarm's live passes in rehearsal mode (item 53);
  3. **ONE FULL LIVE REVENUE CYCLE THROUGH EACH POOL**: sweep, swap, return,
     split, the ledger row closed and `--audit` clean, once through Orca and once
     with Orca forced to refuse (a floor above its price) so the Meteora fallback
     really runs;
  4. **ONE FORCED POST-SWEEP FAILURE, WALKED THROUGH THE HAND RECOVERY**: a cycle
     whose sweep lands and whose swap then fails, the alarm's CRITICAL for a sweep
     with no matching return raised, the next run refused at the open-cycle guard,
     the cycle recovered by hand as limit 10's runbook says, and `--audit` clean
     again;
  5. (carried, A17) one DAS read of a collection holding a burned Core asset,
     settling whether DAS sets `burnt` on it.

**38. EVERY `initialize` VALUE IS WRITTEN ONCE AND CAN NEVER BE CORRECTED.** With
no admin and immutable programs, a wrong launch value is permanent. Each must be
the ruled one before deploy: `max_supply` 2,100; `level_caps` 945/525/315/210/105;
`monthly_secs` 2,592,000; `notice_secs` 604,800; `redeem_window_secs` 3,600;
`min_voting_secs` 259,200; `quorum_bps` 2,100; `threshold_bps` 5,100;
`sweep_floor_lamports` 1 SOL; `cooldown_ceiling_secs` 86,400;
`reserve_ceiling_lamports` 0.1 SOL; the charter window (7 days; the dates are not
yet set); `bank_treasury` the CBOBTC Squads; `payment_mint` cbBTC; the three
reserve mints; `pob_root` from `scripts/pob-set.json`; the guardian; the swap
operator; the sweep cap, cooldown and SOL reserve. The alarm reports a wrong one
only AFTER it is written (`test_value_in_production`), so the values now live in
ONE file, `launch/mainnet-init.json`, each marked RULED, PROPOSED or OPEN with its
source, and `scripts/check-launch-params.mjs` refuses it BEFORE anything is signed
unless nothing is OPEN, every ruled value equals the alarm's production list (the
same list, imported), every bound each `initialize` enforces is met, the swap bot's
values sit in the alarm's working band, and the Proof of Burn root recomputes from
`scripts/pob-set.json` (its selftest, 47 launch assertions behind a floor in
`run-tests.sh`, proves each kind of refusal). Still OPEN: the charter opening date
(Gary) and the lock deadline that follows from it. Everything else is RULED,
including the swap bot's values, the swap operator key (generated 2026-10-04)
and the $CBOB mint (created on mainnet 2026-10-04). ⚠️ Round 24 (A6): the checker
validates the JSON, not the signed transaction, so whoever builds the four
`initialize` transactions must build them FROM that file, and the programs
themselves check less than the checker does (SEAL reads only owners; off-curve
keys are accepted; `redeem_window_secs` may be anything from 10 s to 24 h).

**50. THE SURFACES PROMISED TO HOLDERS ARE NOT BUILT.** The holder guide says the
Bank's pages show each vault's deposit address (its asset-signer PDA, not the
NFT's own address; round 25 D9 added this surface to the list), that the redeem
page checks a vault for anything that would be destroyed and warns before the
holder signs, offers to trigger (and join) a payout first, and empties the vault
at the moment the opening runs so a stranger's deposit cannot block it; and that
every opening is announced on X and the CBOB website. None of the pages exists:
there is no deposit-address page, `judgeRedemptionCoverage` is a pure function
with no page, and `bank/redemption-poster.mjs` drafts posts and has no sender (an
automated new post on @cbobtc needs Gary's go-ahead and the website surface is not
chosen). The sweep helper `programs/cbob-vault-sweep` the page needs is BUILT
(round 24, A3; round 25 D2 corrected "being built"): byte-identical in `dist/`,
`target/deploy/` and the localnet build's release output
(`.cache/ln/sbpfv3-solana-solana/release/`, sha256 `9e21cc9c…`, the file
`scripts/build-mainnet.sh` compares), and watched by the alarm
(`prog.sweep.upgrade_authority`, `prog.sweep.hash`); nothing calls it yet. v6
removed the only other pre-signature check (the Bank), so until the page exists
items 9 and 44 have no preventive control at all. OPEN AND BLOCKING because the
holder guide promises it; it is also a precondition of road step 11. **The holder
guide (marked DRAFT) may not be published before this item ships** (round 25 L1:
it speaks of these surfaces in the present tense).

**What a redemption client (the redeem page first) must do**, written here because
nothing on chain makes it:
  * **Prior transaction:** create the owner's destination accounts (item 42) and
    any of the vault's three reserve accounts that does not exist yet, so the
    sweep can name all three.
  * **`claim` before the sweep, EXCEPT while the pool is frozen** (round 24, D4):
    a claim that pays reverts the whole transaction at the frozen pool, so the
    redemption sends no `claim` and `retire_redeemed` forfeits the undelivered
    share (item 28; suite 3c.F2).
  * **Sweep through the helper** (round 24, A3; "Known limits", the round 23 F1
    entry): one Core `ExecuteV1` into `programs/cbob-vault-sweep`, naming every
    reserve account, so the sweep moves LIVE balances and the vault wallet's
    lamports. A client that sweeps pre-read amounts can be delayed indefinitely
    by a griefer who keeps paying fees.
  * **Mind the legacy packet** (round 25 D9). Measured, Test Vault S8.0: claim + open +
    the helper sweeping all three reserves + burn is **1,061 bytes** with the
    owner as fee payer. Both compute-budget instructions add 52 bytes and a
    separate fee payer adds 96 (32 for the key, 64 for its signature), so the
    widest page shape is about 1,209 of the 1,232: it fits, with 23 bytes to
    spare. S8.1a measured **168,343 CU** for this four-instruction redemption
    (2026-10-05), below its legacy default combined budget of 800,000 CU. This is the
    measured shape, not an upper bound for arbitrary extra token pairs. A
    redemption carries no crank.
  * **A lamports-only sweep needs a destination that exists** (round 25 D9). With
    no token pairs, the helper's only credit is a System transfer of the vault
    wallet's lamports, and a credit below rent exemption to an account that does
    not exist yet is refused. The canonical destination is the owner, who pays the
    fee and so exists; a page that names any other destination must check it.
  * **Offer to rescue stray CLASSIC tokens** (round 25 D7, item 44): the helper
    sweeps any classic SPL account the vault PDA owns when the page names it with
    a same-mint destination account owned by the redeemer, so the coverage check's
    stray classic token accounts can be swept rather than destroyed (the
    destination accounts are created in the prior transaction, item 42; mind the
    packet above, since each pair costs bytes).
  * **Close every reserve account it empties** (round 24, D8; the helper does):
    `burn_vault` checks `amount == 0`, not closure, and nothing can sign for the
    PDA after the burn, so an unclosed account strands about 1,488,440 lamports of
    rent per account on mainnet, the redeemer's own loss.
  * **Set the compute-unit limit** on any transaction that carries a crank, or
    send no crank (item 54); the claim page sends no crank when `pob_extra > 0`
    (item 37).
  * **Run `judgeRedemptionCoverage` before the holder signs** and warn on anything
    the burn would destroy (items 9 and 44).
  * **Deploy, verify and lock the helper with the four programs** (road steps 9
    and 11): it is permanent once the upgrade authority is removed, like them.

**Reader coverage boundary (rounds 28-29).** Monitoring reads legacy/v0/v1
parsed history. Missing required metadata is unknown coverage: the reader
refuses it, scanners keep their cursors, and the alarm reports a failed pass.
The runtime's standalone `Log truncated` marker is different, because ANYONE can
cause it for one fee: an ordinary transaction that merely names one of our
programs (or the revenue account) as an unused account, padded with enough
instructions, is listed by the scanners' signature walks with its logs
truncated (round 29 M1, measured). Refusing the whole pass on it let one
stranger halt every alarm pass, the redemption poster and revenue recovery,
repeatably. So the reader still refuses it by default, and each walking scanner
instead opts in to receive it flagged, with every other field validated: the
alarm pages that signature as a `log_coverage_gap` (HIGH), keeps it in its
state's `logGaps`, does not read its event lines, still runs every
instruction- and token-movement detector on it, and moves its cursor past it;
the revenue scan reads its outflow, which comes from instructions and inner
instructions, not logs; the poster never drafts from its logs and queues a
REJECTED hand-draft entry when it called BURN at the top level. The gap is
real: CBOB event lines in such a transaction (a reschedule, a frozen-claim
deferral, a REDEEMED line) can be lost, which is why each one is paged for a
human to inspect, and a permanently truncated result cannot be repaired by
fetching it again. The cursor advance is only ever past a recorded, paged gap,
and the alarm keeps every cursor when the page is not delivered.

**Transaction-format boundary (validation, 2026-10-06).** The packet sizes and
default-budget figures above certify the stated legacy shapes; S9b separately
exercises v0. Current transaction builders use legacy/v0. Solana v1 is active,
allows 4,096 bytes and 64 inline accounts, and requires explicit compute-unit and
loaded-account-data limits in its message configuration. ComputeBudget
instructions do not configure v1. A future v1 client must set those fields and
measure its own execution; none of these tests certifies a CBOB v1 transaction.
Larger packets do not change the protocol's reserve, attribute or per-instruction
crank bounds. See the [official format comparison](https://solana.com/docs/core/transactions/versioned-transactions).

**52. THE POOL'S AND THE SQUADS' cbBTC ACCOUNTS MUST EXIST BEFORE THE FIRST
SPLIT, AND THE REVENUE ADDRESS MUST HOLD RENT** (round 22, S5 and F26). The CBOBTC
Squads address `bc92Z…` was verified on mainnet 2026-10-03 to be a Squads VAULT
(off-curve, no account of its own) whose cbBTC ATA already exists. The revenue
address starts at 0 lamports, so a first royalty smaller than rent exemption
would fail: fund it above rent at launch. `initialize` only DERIVES the pool address; nothing creates
the token account, and `split_revenue` needs both it and the CBOBTC Squads' cbBTC
ATA. Until both exist every split fails (loud: `pool_unreadable`,
`revenue_unsplit`). ⚠️ Round 24 (D8): an explicit `distribute` reads the pool
account BEFORE anything else, so until the pool's cbBTC account exists every
`distribute` refuses, EVEN THE FREE LAUNCH TICK that credits nothing and only
advances the epoch so waiting vaults can join, and with it the crank's own
monthly call. The in-line monthly run in a host instruction degrades gracefully
instead (it performs the launch tick without reading the pool, and treats a pool
that is not yet a token account as holding nothing). Road step 10 creates both, idempotently, right after
`initialize`. Round 23: the revenue address's OWN cbBTC account must exist too
before the first paid `mint_vault`, which pays into it; road step 10 creates it
with the other two.

**53. A DRESS REHEARSAL AT THROWAWAY PROGRAM IDS CANNOT RUN THE SHIPPED OFF-CHAIN
CODE UNCHANGED** (round 22, from a disqualified report, verified): the program
ids are constants in `bank/layout.mjs`, `bank/revenue.mjs` and
`bank/detectors.mjs` (and in `bank/alarm.mjs`, `bank/selftest.mjs`, the four
programs' cross-references, the tests and the sim). **ADDRESSED by a recorded patch,
not by changing the audited code:** `scripts/rehearsal-tree.sh` makes a detached
worktree of HEAD outside the repo, generates five throwaway program keypairs, and
applies exactly six substitutions (the five program ids, the sweep helper's
included, and the repo root path, so the rehearsal's keys, locks and caches never
touch production's; round 25 D6 corrected "five ... the four ids"). It then PROVES the
patch is only that: reversing the map recreates every file of HEAD byte for byte,
git's own diff names the same files, and all five programs plus `bank/layout.mjs`
were patched. No derived address (config, pool, mint authority PDA) is hard-coded
anywhere in the code, measured 2026-10-04 by deriving our PDAs under every seed we
use and checking every off-curve literal, so the ids are the whole patch. It writes
`REHEARSAL-RECORD.txt` (commit, map, patch sha256). It never builds or sends.
The shipped cron installer refuses any tree with this rehearsal marker before
touching the host's production jobs or logrotate configuration. Run the rehearsal
commands explicitly; do not install them into the production cron schedule. **Proven
2026-10-04 at `d57ee3a`: the FULL `scripts/run-tests.sh` passes inside the
rehearsal tree at throwaway ids** (every gate of that commit, on-chain and off). Its first run caught the one thing a byte-exact reverse
cannot: a selftest regex written as an ABBREVIATED id, now fixed, and the script
refuses any leftover 4+ char id prefix. ⚠️ Round 24 (D4): that proof is of
`d57ee3a` and is STALE; it must be re-run at the release commit, which is why
this item stays OPEN.
⚠️ **Round 24 (D5): "the ids are the whole patch" is true of ADDRESSES, not of
VALUES.** The alarm judged every pass as mainnet (`production: true`, with
`pob_root`, the PoB collection, the governance numbers and the lock deadline
pinned), so a rehearsal at throwaway values pages `test_value_in_production` and
`lock_deadline_unset` on EVERY pass, and at the ruled values nothing can mint for
about ten days (the 7-day charter, then a 3-day vote for a round) without burning
a real Proof of Burn. **HOW THE DRESS REHEARSAL MUST RUN THE ALARM:** inside the
rehearsal tree, with `CBOB_ALARM_REHEARSAL=1` exactly (`bank/detectors.mjs`
`alarmProduction`; any other value, or none, is production, so a typo fails
closed). That turns OFF only the production-value checks (`test_value_in_production`
and the lock-deadline checks); every other detector runs unchanged, and every
report and every notice says REHEARSAL. Its notices go to the same alert router
under the same `cbob-vault-alarm:<kind>` labels, so run it either `--dry-run`, or
with the router's `ALERT_STATE_DIR` and `ALERT_LOG` pointed at a rehearsal
directory (outside this repo), so a rehearsal stream can never mute or close a
production one. **Still to write before the rehearsal (not built, named so it is
not assumed):** the REHEARSAL VALUE SET, a `launch/rehearsal-init.json` beside
`launch/mainnet-init.json` with the shortened periods the rehearsal initializes
with (each inside its `initialize` bound: `monthly_secs` and `notice_secs` at
least 60, `min_voting_secs` at least 60, `redeem_window_secs` at least 10, a
charter window of minutes, throwaway guardian, operator and PoB set), and a
rehearsal mode in `scripts/check-launch-params.mjs` that judges it against those
bounds instead of refusing it for not being the ruled mainnet values.

---

### DISCHARGED: measured closed, or gone with the thing it was about

*Moved here from OPEN AND BLOCKING in round 24 (D4): decided and built, so it
blocks nothing. Its one accepted residue, boost timing, stays disclosed below.*

**51. LEVEL-UPS BY BURNING $CBOB: DECIDED AND BUILT AS THE $CBOB BOOST
(2026-10-04).** Gary: build it before the lock; a TEMPORARY boost, not a level
change; outside the caps; terms by a Governor vote, off at launch; the $CBOB mint
created first. Built in MINT (`boost_vault`, `expire_boosts`, `set_boost_terms`,
the carry, the `BoostsExpireFirst` gate) and GOV (`SetBoostTerms`, ordered like a
round, bounds checked at creation). Owner-only since round 23 (Gary: "no gifted
boosts"; `BoostNotTheOwner`, suite BO.6). See DESIGN-v6 section 3. Measured by suite
section BO and init arms 0.1o-0.1v; mirrored off chain in `bank/accrual.mjs`
(`reweigh`, `pendingScaled`), the crank (expiry before and after a distribution)
and the alarm (`boosts_stalled`, the boost bounds watched as fixed forever).
The $CBOB mint exists on mainnet (`GMm2yY2z…`, created 2026-10-04 with NO mint and
NO freeze authority) and the ceilings are ruled, weight 12 and 24 distributions
(`launch/mainnet-init.json`). Since round 23 `boost_vault` also takes the
buyer's terms (`max_price`, `min_weight`, `min_epochs`): a vote that moves the
terms AGAINST the buyer between signing and execution (price above `max_price`,
weight below `min_weight` or epochs below `min_epochs`) refuses with
`BoostTermsMoved` and burns nothing. ⚠️ Round 24 (D1): a move in the buyer's
FAVOUR (a lower price, more weight, more epochs) is not refused; the boost lands
at the NEW terms, including a longer hold on the vault's one boost slot. This is
the ruled, one-sided rule; earlier text here said any change refused.
**A boost is N DISTRIBUTIONS, not N months (round 23 F2; Gary: "that's part of
the game theory on boosts").** The 100 $GARY burn path has no interval, so anyone
who sends the pool a sat and burns 100 $GARY runs a distribution: a
24-distribution boost can be run out in a few transactions for about 2,400 $GARY,
and that ends every live boost at once.
**What a vote can do with the terms:** switch boosts on at any price above zero,
at +1..+12 weight for 1..24 distributions, or off. It is an ordinary action
(10.71% YES after a 3-day public vote), not a key change. It cannot touch a live
boost, a level, a vote, the census, the 85/15 or custody.
**Who can boost at launch:** the release wallet holds all 2,100,000,000 $CBOB,
so until the Bank releases some, nobody else can buy a boost.
**Retired records keep `boost_weight` and `boost_end_epoch` as history;** they
are inert (`retire` unschedules; `claim`, `expire_boosts` and the crank skip
retired records).
**What a boost does NOT do, stated for holders:** it does not change a level, a
vote, the census or the 85/15; it buys a larger share of the next N
distributions only, and those are only as large as the revenue behind them. A
burner is partly bidding for bitcoin their own purchase helped put in the pool.
**Boost timing (accepted, disclosed):** a boost earns from the next distribution,
so a burner who expects a large one (a big sales week) can time the purchase. Every
boost still receives exactly N distributions whatever their size; the price is set
by a vote that can see the same flows.

*Moved here from OPEN AND BLOCKING in round 24 (D4): measured, and the crank is
unaffected. What it requires of the holder pages (the compute-unit limit) is
a requirement of item 50, which stays OPEN.*

**54. COMPUTE AT THE WIDEST HOST SHAPES: MEASURED 2026-10-04, AND IT BINDS THE
HOLDER PAGES** (round 22, D7; suite arms 10.5, 10.6, 10.6a, simulated so nothing is
consumed; figures re-read at `2b67fb1`, round 25 D6, `.cache/suite.log`). One
capture walks the full 512-entry SlotHashes three times and costs **114,756 CU**.
A plain mint costs 75,898; a mint carrying the full crank of 4 due captures costs
**524,588**, inside the 1,400,000 transaction maximum but REFUSED
under the legacy/v0 default 200,000 budget (10.6a proves the default refuses exactly when the
measured cost says it should). One piggybacked capture is NOT safely under the default
either: arm 10.6b measured a mint plus one capture at **188,594** with all 512
entries (lands, 5.7% spare), yet in round 25's third suite run a paid mint carrying
one capture ran out at exactly 200,000 and failed, and a charter claim is heavier
than a mint. The suite's own one-capture sends passed in earlier runs only because a
fresh validator's SlotHashes was still short; every crank-carrying send in the suite
now sets the limit, as below. Consequences:
  * **The bank's crank is unaffected**: it sends each capture as its own
    transaction (114,756) and each reveal alone (150,344 with its inline capture,
    arm 10.4).
  * **Holder pages (item 50) must set the compute-unit limit on ANY transaction
    carrying a crank**: host cost + 115,000 per capture + margin, and MAX_CRANK
    is 4 per host instruction. A legacy/v0 page that cannot rely on the wallet
    keeping its compute-budget instruction sends NO crank; the crank lane
    captures within a minute anyway.
  * A claim batch costs about 4,000 CU per vault (P.31: 6 vaults, 29,192), so the
    crank's 14-vault batches sit near 60,000, far under the legacy/v0 default (extrapolated
    from the measured per-vault cost, not measured at 14).
  * Not changed on chain: a binary search over SlotHashes would make captures
    cheap, but it rewrites the entropy reader during the freeze to save holders a
    compute-budget instruction. Recorded as an option, not taken.

**12 / 17 — compute units.** Was: "unmeasured anywhere; there may be a CU ceiling
below the 1,232-byte ceiling", promoted to release-blocking after five auditors
across rounds 18 and 19. **MEASURED on the v5 artifact** (`meta.computeUnitsConsumed`
off landed transactions, not a simulation): a plain mint 58,956 CU / 890 bytes;
the widest pad that measured legacy packet allows is 18 instructions at
73,657 CU / 1,228 bytes,
leaving 1,326,343 CU of the 1,400,000 cap. At 816.7 CU per padded instruction,
exhausting compute would need roughly 1,700 padding instructions — about 32,000
bytes of transaction. **The byte wall binds more than twenty-five times before the
compute wall in that legacy shape**, so that shape fits under the measured CU budget
ON THE PADDED-MINT PATH. This is not a v1 packet or resource-budget measurement.
(Round 23: a mint carrying four captures fails at the legacy/v0 DEFAULT 200,000
budget, item 54.) Assertions 10.1–10.4, including a
deliberately generous 400,000 CU regression ceiling that exists to catch an
order-of-magnitude change, not to pin today's number.

**14 — duplicate attribute keys are not rejected at mint.** **CLOSED on chain**:
`mint_vault` and `claim_charter_vault` refuse `DuplicateAttribute`. It was bounded
and harmless while attributes were provenance only; the level made it
load-bearing, because a map a reader takes a money decision from may not have two
answers. Assertion 11.4.

**19 — the unlevelled-vault halt as a customer-triggerable payout DoS.**
**CLOSED BY CONSTRUCTION**, and it was the single most-reported finding in this
project's history: fifteen of twenty-two auditors across rounds 18 and 19 called
it a public DoS, because anyone could fund a vault to 21,000 sats before its
`levels.json` entry existed and stop every payout until a human edited JSON.
`levels.json` is deleted. In v5 the level was proven against a pre-committed deck
at mint; in v6 it is drawn on chain after the mint, and `activate` refuses a vault
whose level is not drawn (`NotRevealed`), so **there is no state in which a vault
is activated but unlevelled**, and the payout reads the level from the vault's
own record. v5's off-chain allocator kept a refusal for an unreadable level
(excluding one holder silently overpays every other holder); v6 has no off-chain
allocator, so there is nothing left to halt.

**30: ~~the 85/15 ratio is still a VOTE.~~ DISCHARGED by stage 3b:** `split_bps`,
both destinations and `max_supply` are written once by `initialize`; `update_wiring`
no longer exists (P.0e, P.0f). History: in stage 1 `split_bps` was a governance
wiring field, so holders could vote their own share up or down.

**31: ~~the 31-day branch of the cadence is reasoned, not exercised.~~ SUPERSEDED
by stage 3b:** the cadence is deleted; the free path's period is an `initialize`
value (150 s in the suite), so it IS exercised now (PG.8, PG.9, IN.*).

**33: ~~a replacement swap operator lands after seven days, and that branch is
reasoned.~~ DISCHARGED by stage 3c:** the notice is an `initialize` value
(`notice_secs`, 60 s in the suite), so the successful apply is exercised for both
keys: 3c.K5 lands an armed swap operator and 3c.G2 a new guardian once the notice
has run, and 6.20g / 3c.G1 refuse an early apply. The 7-day value is the same
arithmetic.

**v5 items that went with the Bank, the co-signer, the deck or the distributor:**

- **1a. The co-signer's program allowlist and fee-payer check were off chain** (and
  the Bank-pubkey confinement was on chain, `BankKeyOutsidePair` /
  `BankKeyOutsideMint`; round 20 caught 1a under-claiming that). **Gone:** v6 has
  no Bank key, so there is no privileged signature to confine and no Bank SOL for
  a fee payer to spend; SEAL's second instruction walk was deleted with it.
- **1b. The Bank's policy was procedure, not enforcement.** **Gone:** there is no
  Bank policy; the programs' rules are the whole second party.
- **2. A coverage refusal had no override** (a stranger's airdrop could make a
  vault unredeemable until an operator intervened). **Gone:** nothing refuses a
  redemption off chain any more. The cost moved: an undeclared airdrop is now
  destroyed rather than blocking (item 44).
- **3. The Bank could be named `payer` inside the approved pair.** **Gone** with
  the Bank.
- **4. The allowlist permitted a bare Core `BurnV1` of a second vault beside a
  real redemption.** **Gone** with the allowlist. A bare burn by the owner is still
  possible (proven impossibility 1) and `retire_burned` / the alarm handle it.
- **5. The judge never looked at where swept money goes.** **Gone** with the
  judge; the destination was always the holder's to choose.
- **11. Distribution reconciled against a ledger the payer wrote.** **Gone:** v6
  has no payer and no ledger; the accounting is the MINT config's accumulator and
  `owed_scaled`, and P.32 asserts the pool always holds what it owes.
- **15. A vault minted during an open proposal could vote on it.** **CLOSED ON
  CHAIN** by v6 stage 2: `VaultTooNew` against the proposal's `index_snapshot`.
- **16. The Bank-as-fee-payer gap on the mint path.** **Gone** with the Bank.
- **18. The unsigned transaction was visible in `ps`** (`scripts/bank-sign.sh`).
  **Gone:** the script is deleted.
- **20. A poisoned ATA silently removed one holder while a whole-payout halt
  paged.** **Gone** with `bank/distribute.mjs`. In v6 a frozen vault account is
  deferred and stays owed (item 28), logged `CBOB_CLAIM_DEFERRED_FROZEN`, and the
  alarm reports `claim_deferred_frozen`; a claim never creates or redirects an
  account.
- **21. The mint confinement foreclosed ever putting the Bank key in a
  multisig.** **Gone** with the Bank.
- **23. The deck size had to be decided before minting opened.** **Gone:** stage
  2 deleted the deck. Kept for the record, because it reversed its own
  conclusion: measured at last, the PACKET held 29 / 18 / 13 caller attributes at
  deck depth 7 / 11 / 13 against a program limit of 7, so the program bound and
  deck size never squeezed provenance; a round-20 CRITICAL saying not even zero
  fit at depth 11 was refuted by that measurement. v6's attribute budget
  depends on no deck: 640 stored bytes, proven to fit a legacy reveal (L.12).
- **24. The deck was fair; the queue was not** (the Bank co-signed every mint, so
  it chose who reached which index, and with the published deck could hand
  Level V to chosen parties). Written as OPEN TO GARY with three options; **v6
  took option (b)**: the Bank is gone from `mint_vault`, and with no deck there
  is no index-to-level map to aim at. What replaced it, and what that leaves, is
  items 25 and 26.

## The off-chain pipeline (v6) — `bank/`

v6 moved the money into the programs. There is no Bank key, no distributor
wallet and no co-signer, and the files that held them (`bank/cosign.mjs`,
`bank/deck.mjs`, `bank/distribute.mjs`, `scripts/bank-sign.sh`) are deleted. What
is left off chain is what a program structurally cannot do for itself: SEE (Core
cannot enumerate what a PDA owns), NOTICE ABSENCE (a program never runs unless a
transaction arrives), and WATCH WHAT IT RESTS ON (Metaplex Core, cbBTC's freeze
authority, and our own programs until they are locked).

| file | job | moves value? |
|---|---|---|
| `bank/layout.mjs` | every account layout, ONCE, asserted field-for-field against the Rust structs and against every cross-program offset the programs pin | no |
| `bank/crank.mjs` | Scheduled permissionless calls, which anyone may also submit. Monthly distribution has a third fallback: ordinary traffic can credit the due distribution in-line once prerequisite joins and boost expiries are complete. Activation, joining and claim delivery still require their explicit instructions. Every minute: reschedule, capture, reveal in mint order. Hourly, in this order (red-team 3 finding 6): the same, then retire bare burns, JOIN every eligible waiting vault, the free monthly distribution, activation requests at 21,000 sats, claims in batches of 14 (skipping frozen accounts and never paying or joining a positively burned vault). Permissionless instructions only; its key pays fees and each reveal's attribute rent, is refused below what the pass's plan costs, and above 0.25 SOL still runs and warns once a day. Only a positively LIVE asset is joined or paid (round 23 L2), and bare burns are retired at any level (I1). Each LIVE full pass stamps `bank/.crank-heartbeat` for the alarm. `MonthNotElapsed` on its own distribute is logged as done (traffic ran the month), not a failure. Round 24: a stranger's split (`NothingToSplit`) is benign, and a refused distribute is re-judged against a fresh config read (benign only if another distribution moved the epoch; `PoolShort` never); a split is planned only into a live, unfrozen pool AND CBOBTC Squads account; a reveal is sent with `[]` only for a positively burned asset; the plan runs against the chain's Clock and frees a retiring vault's share before it distributes; a key short of the reveals' rent still sends everything else and pages the reveals it dropped; each lane pages on its own stream with a recovery, and the heartbeat carries the pass's failures and problems | only where the program already sends it; installed dry-run |
| `bank/alarm.mjs` + `bank/detectors.mjs` | every 30 minutes: approvals, PDA token accounts, burns, balance falls, nested vaults and off-curve owners, config and program drift (including the PoB collection's plugins and update authority), launch values that are not the ruled ones, an overdue distribution, the pool (frozen / short / unreadable), redemptions near the rolling-hour cap, the brakes (pull and release, URGENT), an armed guardian or swap operator, reschedules and frozen claims (attributed by the invoke stack, URGENT), a program still upgradeable past the lock date (the earlier of `lock_deadline` and MINT's `charter_opens_at`), and since round 23 the revenue cbBTC account (frozen / unreadable / unsplit, the unsplit clock restarting at the last split the scan saw), royalty SOL unswept for a day, and an armed crank whose heartbeat is over 3 hours old. Round 24: each finding KIND is its own alert stream (`cbob-vault-alarm:<kind>`), every kind whose baseline moves after reporting is sent ALERT_URGENT with the pass time, the full detail list is sent, a level kind gets a RECOVERY on the first full pass that no longer finds it, a freeze pages when it happens and stands at INFO, an unreadable crontab or a repeating crank failure/problem pages, a holder's pool-frozen forfeit pages, and the revenue ledger is held to the chain's sweeps and splits. `CBOB_ALARM_REHEARSAL=1` is the dress rehearsal's mode (item 53). Daily `--reconcile`: what each vault PDA owns, with separate `cbob-reconcile:<kind>` streams and saved recovery history. An incomplete census preserves prior conditions and sends no recovery. A dead-man's switch pages if the alarm's state goes stale | no |
| `bank/lock.mjs`, `bank/sigwalk.mjs`, `bank/spl.mjs`, `bank/anchor.mjs` | shared helpers: the flock wrapper and ledgers, the signature walk, token-account reads, pinned Anchor account reads | no |
| `bank/accrual.mjs` | the program's payout arithmetic mirrored in BigInt, for the crank and the alarm | no |
| `bank/revenue.mjs` | the one trusted hop: royalty SOL -> cbBTC -> split. Mint prices arrive as cbBTC and need no swap | yes, opt-in `--live` |
| `bank/redemption-poster.mjs` | drafts the public post for every redemption. **No sender** — needs Gary's go-ahead and a website surface | no |

**A read that fails is an alarm, never a pass**, and every v5 rule that enforced
that survives: a missing state file is not day one, a cursor the cluster cannot
resolve is a CRITICAL, an undelivered finding keeps every baseline, the
dead-man's switch watches the watcher, and a dry run consumes nothing.

## Where this stands, honestly

**v6 build state.** Programs are built through stage 3c and the off-chain
pipeline through stage 4. `audits/FREEZE.md` links the completed rounds and
their dated repair-validation records; "Running the tests" gives the current
enforced counts. Red-team 3 (`audits/v6-redteam/RT3-stage3c.md`) found **no
CRITICAL or HIGH** and one MEDIUM plus six LOW, all fixed in stage 3c (one LOW
fixed in the crank and accepted on chain, item 27). The Test Vault simulation
(`sim/`, one vault's whole life against real mainnet Core and the real cbBTC,
$GARY, $GIRAFFISH mints and two real Proof of Burn assets, cloned) is built and
passes 71/71 (road step 5), with any reuse boundary stated in the applicable
repair-validation record. Current round results, quorum limits and the
clean-round counter are recorded in `audits/FREEZE.md`.
**Nothing is deployed, nothing has minted, nothing holds real
value**, and v6 must earn the two clean rounds recorded in `audits/FREEZE.md`.

**v5's stopping condition was never reached.** The bar was two consecutive rounds
in which every finding is already-known, already-fixed, or disproved by a test
actually run. Twenty-one rounds each found something real. What changed across
them was where the findings came from: by rounds 9 and 10 every accepted finding
was in the WATCHER or in the previous round's own repair, not in the vault
mechanics (the seal, the open/burn pairing, the burn emptiness proof, the
cross-program config pinning and the hand-built Core CPIs), and rounds 20 and 21
found their worst defects in the newest code (the deck and its queue). v6 then
deleted most of that newest code (the Bank, the deck, the co-signer, the
distributor) and added new code of its own (the pool, the draw, the guardian,
bounded governance, the rate limit). Those changes received three single-agent
red-team passes before multi-model auditing began. Current round results and
quorum limits are recorded in `audits/FREEZE.md`.

The remaining risk is concentrated in these places, named rather than implied:

1. **The new v6 money code**: the pool's accumulator, the two-step activation and
   join gate, the in-line monthly run, the rolling redemption window, governance
   execution with skips. It is the youngest code here, it moves value, and it
   becomes permanent at launch. Red-team 3 recomputed every cross-program offset,
   account size and discriminator and found them correct; that is one reader.
2. **The off-chain pipeline.** It carries what a program structurally cannot do
   (see, notice absence, watch what it rests on), so it cannot be deleted, and it
   has never run against a live deployment (item 22).
3. **The one trusted hop.** The SOL to cbBTC swap cannot be made trustless
   without a DEX CPI. It is bounded on chain, ledgered, stoppable by the
   guardian, and carries only royalty SOL; **the swap operator wallet must hold
   nothing but the cycle's own funds.** That is an operational instruction, not
   a code guarantee, and it is stated as one.
4. **The governance concentration is a business fact, not a bug.** Measured on
   mainnet 2026-10-03 (DESIGN-v6 section 10): 240 Proof of Burns across 42
   holders, the largest wallet 41 (17.1%), the top three 37.9%. At quorum 21% and
   threshold 51%, if 15% or more of the Proof of Burns go unclaimed the largest
   holder alone reaches quorum and passes an ordinary proposal (rounds, prices,
   restarts). It cannot change a guardian or swap operator (half of ALL live
   vaults) or anything fixed at `initialize`. ⚠️ Round 24 (D5): that is the
   largest holder alone. The TOP THREE (91 Proofs of Burn) carry a key change
   (guardian or swap operator) on their own if 58 or more of the 240 (24.2%) go
   unclaimed, because no paid vault can exist before a round vote executes, so
   "half of all live vaults" at the first proposals is half of the charter
   vaults. And an ordinary proposal (21% quorum, 51% of votes cast) can open a
   round with a cap of 2,100 at the 21,000-sat floor (a sell-out at the floor): MINT bounds
   the price and the lifetime supply, not the size of one round.
5. **The surfaces promised to holders and the launch values** (items 50 and 38),
   both open. v6's Bank duties are gone: the vote snapshot and the charter
   claim's Proof of Burn burn are on chain now.

### Shared error-code diagnostics

Two MINT error names cover more than their short runtime messages suggest:
`WrongGaryMint` covers a supplied token program other than classic SPL, a mint
address other than pinned GARY, or a mint owned by another program. Anchor’s
Left/Right logs identify the failed key comparison; the existing short message
alone does not distinguish them. `SweepAboveCap` also rejects a zero sweep
amount, as well as an amount above the per-sweep cap. These are diagnostic
ambiguities, not additional permitted operations (suite 6.17b pins zero refusal).

## THE SHIP GATE

> **RULING, Gary 2026-08-22: there will be NO human audit firm. This system is
> audited by AI or not at all.**

Every earlier version of this document leaned on a professional firm reviewing a
frozen version. That backstop is gone, so the AI process now carries the whole
weight and its three structural weaknesses have to be answered rather than
deferred. Named, with what answers each:

| what an AI round structurally cannot do | what answers it here |
|---|---|
| **It reasons; it never executes.** ~1/3 of "CRITICAL" findings across nineteen rounds were WRONG on measurement. | The 855 assertions, real cloned Core suite runs against **real mainnet Core cloned onto a validator**, minting real vaults and moving real tokens. It is what has disproven every wrong claim. |
| **It sees only the bundle.** Rounds 11 and 12 both produced their worst findings in files no auditor had seen, and five files had escaped **thirteen** rounds. Round 19 then asked auditors about three files it had not put in either bundle, which produced two confident wrong findings. | `scripts/audit-coverage.sh` diffs every audit prompt ever bundled (including a prepared, not yet run, round) against every tracked file under `programs/`, `bank/`, `scripts/`, `sim/`, `launch/` and `tests/` plus SPEC, DESIGN, the holder guide and the workspace manifests (excluding only the audit scripts, generated `Cargo.lock` files and `bank/.gitignore`) and fails if anything has never been bundled (round 29 L1: it used to enumerate a hand-picked subset that missed `sim/fixtures.mjs`, the program manifests and the PoB set), and the runner refuses to name a file it did not deliver. |
| **Every round audits code the last round could not see, so rounds never converge.** | The FREEZE below. Without it the stopping condition is unreachable by construction, which is why it was met zero times in twenty-one v5 rounds. |

**All five must hold at once. Any commit to `programs/`, `bank/` or `scripts/`
resets 2 and 3 to zero.**

1. **Coverage.** `scripts/audit-coverage.sh` exits 0 — no tracked system file has
   escaped every round's bundle (it counts bundling, which a prepared round earns
   before it runs).
2. **Frozen.** No change to `programs/`, `bank/` or `scripts/` since the first of
   the clean rounds began.
3. **Two consecutive clean rounds against that frozen tree**, where "clean" means
   no finding survived measurement. **The second must use a DIFFERENT model
   roster than the first** — the same eight models re-reading an unchanged tree is
   one round run twice, and agreement with yourself is not independence.
4. **Every ACCEPTED finding, in every round, has a gate that FAILS THE BUILD,
   proven in BOTH directions.** A gate that has only ever said OK is untested.
5. **Every REJECTED finding that could be measured is an ASSERTION in the suite.**
   This is the answer to "the auditors are often wrong": we do not win the
   argument and move on, we convert it into a permanent test. So nobody
   re-litigates it, and a future change that quietly makes the rejected claim TRUE
   turns the suite red. Round 13 did this twice — 9.12/9.13 pin that a burned
   asset address cannot be reused, and 9.14-9.16 pin the reserve-mint ceiling to a
   measurement rather than to anyone's arithmetic.

v5: twenty-one rounds, twenty-one with a real finding. The gate has been met
**zero** times, and v6 reset the counter (`audits/FREEZE.md`, 2026-10-03).

### The road from here to Bitcoin (v6), in order

Each step must be complete before the next starts. Where it stands today:

| # | step | state |
|---|---|---|
| 1 | Gary approves the design (`DESIGN-v6.md`) | done 2026-10-03 |
| 2 | Programs: stages 1, 2, 3, 3b, 3c | **built**, stage 3c committed `9312275` |
| 3 | Suite and off-chain pipeline (stage 4) | **built**; `run-tests.sh` green |
| 4 | Independent red-team passes | **three done**; RT3 found no CRITICAL or HIGH, everything fixed or accepted |
| 5 | Test Vault simulation (`sim/run-sim.sh`, `sim/test-vault.ts`) | **done, 71/71** (every refusal pinned to its reason). It found one fixture artifact worth knowing: mainnet's rent rate is now LOWER than the test validator's, so cloned accounts are topped up to local rent (asserted rent-exempt on mainnet first) |
| 6 | Launch values decided (item 38) and holder surfaces built (item 50); not a numbered step in DESIGN-v6's build order, placed here because both must exist before anything mints. Independent of the freeze and the audit rounds, so it runs beside them | **values in `launch/mainnet-init.json`, refused by `scripts/check-launch-params.mjs` until complete**: all RULED except the charter opening date (Gary) and the lock deadline that follows from it (24 h before it); the swap bot's values (10 SOL, 6 h, 0.05 SOL) and key, the $CBOB mint and its release wallet, and the boost ceilings are ruled. Holder surfaces open |
| 7 | FREEZE, then two consecutive clean AI audit rounds with different rosters (gates 1-5 above). SHIP-GATE CONDITION (round 23, D4; round 22 G2): `scripts/run-tests.sh` SKIPS the live-mainnet probe when DNS fails, so the certifying run must show the probe RAN (its floor line printed, not "SKIPPED"); a skipped probe does not count | **frozen; current round results and clean-round counter in `audits/FREEZE.md`** |
| 8 | Mainnet dress rehearsal: throwaway program ids, small real amounts, the crank and alarm live, and item 22's named pass/fail items, including (round 25 L5) one full live revenue cycle through BOTH pools (Orca forced to refuse once, so Meteora runs) and one forced post-sweep failure walked through the hand recovery | not started |
| 9 | Deploy; verify the deployed bytes against `scripts/build-mainnet.sh`'s sha256. Round 24 (A3): the sweep helper `programs/cbob-vault-sweep` is deployed and verified with the four (item 50); `scripts/build-mainnet.sh` builds it and proves its mainnet bytes identical to the tested ones (it has no key to ask about) | not started |
| 10 | `initialize` all four programs with the ruled values, SEAL first (MINT and BURN refuse a SEAL that is not there; GOV refuses without MINT). It needs only `INIT_AUTHORITY`, not the upgrade authority. Then, idempotently and before the first paid mint (item 52): create THREE cbBTC accounts, the pool's (MINT config PDA), the revenue address's own (`["revenue"]` PDA) and the CBOBTC Squads' (verified to exist 2026-10-03; re-check), and fund the revenue address above rent exemption | not started |
| 11 | **Remove the upgrade authority from all four programs, and from the sweep helper (item 50).** After this nothing can be fixed (item 39). PRECONDITION (round 23, D6): item 50's redeem page exists, runs `judgeRedemptionCoverage` before the holder signs, and sweeps through the helper. Build it OUTSIDE `programs/`, `bank/` and `scripts/`, or before the freeze: any change there resets the freeze counter (gate 2) | not started |

Nothing is deployed and nothing has minted.

⚠️ **THIS PARAGRAPH SAID "THIRTEEN" UNTIL PHASE 1, AND SO DID THREE ROWS OF THE
TABLE ABOVE, AND THE SUITE SIZE BESIDE THEM SAID 270 AGAINST A REAL 311.** Six
rounds of findings had landed underneath a section describing the process that
found them. The stated-count gate in `bank/selftest.mjs` read exactly ONE
occurrence of each of three floors, so every one of these was invisible to it.
It reads every occurrence of every floor listed in its check map.

The pattern that keeps producing findings is nameable now: **a fix is a change,
and a change is a place a defect can live.** Its most common shape here is a fix
applied to one of two identical sites, which has happened in five rounds running.

The local validator runners load pinned mainnet Classic Token, Token2022 and
Associated Token Account programs and compare their deployed bytes with those
pins after startup (`scripts/token-programs.sh`). Round 28 found that the bundled
Token2022 and ATA differed; Classic Token matched. Pins describe a captured
mainnet version, not protection against a future third-party upgrade. The
four-assertion expiry-budget gate uses twenty distinct synthetic genesis records
and actual MINT execution; it does not replace full lifecycle tests.

## Running the tests

```bash
./scripts/run-tests.sh          # 855 assertions, real cloned Core, real SPL tokens
                                # (+ 891 detector, 39 allocation, 22 poster, 4 expiry-budget,
                                #  14 Proof-of-Burn, 47 launch and 33 live-mainnet
                                #  assertions, run by the same script, each behind an
                                #  assertion FLOOR that must EQUAL its count: an exit
                                #  code cannot tell "all passed" from "stopped early
                                #  and passed what it reached", and a floor that only
                                #  bounds below accumulates slack)
                                # THESE NUMBERS MOVE WITH THE FLOORS IN
                                #  scripts/run-tests.sh AND bank/selftest.mjs, and
                                #  bank/selftest.mjs checks EVERY occurrence here.
./sim/run-sim.sh                # the Test Vault: 71 simulation assertions, floor SIM_FLOOR
./sim/swap-fork.sh              # 16 swap-fork assertions, floor SWAP_FLOOR (also run by run-tests)
./scripts/build-mainnet.sh      # mainnet artifacts + proof of which key shipped,
                                # for the four initializing programs and the stateless sweep helper;
                                # records the commit, refuses a dirty tree, checks the tested helper bytes
node bank/accrual.mjs --selftest          # 39 allocation assertions: the program's payout arithmetic
node bank/redemption-poster.mjs --selftest # the public post's copy rules, both ways
node bank/crank.mjs                       # plan one crank pass against mainnet (dry run)
node bank/revenue.mjs --audit         # SOL swept vs cbBTC returned
./scripts/validate-core-gate.sh # proves the runner's Core check fires both ways
node bank/selftest.mjs          # proves every alarm detector fires both ways
node bank/alarm.mjs --reconcile # STATE, not history: what each vault PDA owns
./sim/run-sim.sh                # the Test Vault simulation: one vault's whole life
                                # on its OWN fresh validator with real mainnet Core,
                                # the cloned cbBTC/$GARY/$GIRAFFISH mints and two
                                # cloned Proof of Burns. It refuses to start while
                                # scripts/run-tests.sh runs (they share ports).
node scripts/probe-mainnet-facts.mjs      # the things this rests on that the
                                # local validator CANNOT test: the alarm's
                                # signature walk against a live busy program, the
                                # reserve mints and $GARY being classic SPL, and
                                # the 240-address Proof of Burn set
```

The runner builds with `--arch v3`, deactivates SIMD-0500 and SIMD-0161 (both
unscheduled on mainnet) so real Core can load, uses a FRESH ledger every run, and
**refuses to deploy or test unless Core on the validator is byte-identical to the
mainnet dump.** It once certified against the wrong validator; it cannot now.
