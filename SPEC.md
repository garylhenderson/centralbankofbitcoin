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
including the last, so that process never converged. v6 is a redesign and has had
three independent red-team passes (`audits/v6-redteam/`), not yet a multi-model
round. See "THE SHIP GATE" at the end, which is the only thing that decides whether
this holds Bitcoin.

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
| **governance** (the vault holders' vote, via GOV's `["gov"]` PDA) | sale rounds and prices, restarts, tightening the swap bounds, arming a new guardian or swap operator (half of ALL live vaults + 7 days' notice) | cannot touch the 85/15 split, its destinations, the 2,100 cap, the 10% royalty, a vault, or the reserve list (all fixed at `initialize` or by Core) |

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
| **A VOTE REACHES ONLY WHAT MAY CHANGE** | a proposal before the charter closes, a vote by a vault minted after the proposal, a pass on thin turnout, a guardian or swap-operator change without half of ALL live vaults or bundled together, a sweep "tightening" that loosens or passes the bounds fixed at `initialize`. `programs/cbob-vault-gov/src/lib.rs` refuses `CharterNotClosed`, `VaultTooNew`, `TurnoutTooLow`, `KeyChangeNeedsHalf`, `KeyChangesBundled`, `Loosening`, `TightenOutOfBounds`; `programs/cbob-vault-mint/src/lib.rs` re-checks `TightenOutOfBounds` and `PriceBelowFloor`, and lands a new guardian or operator only after the notice (`GuardianNoticeNotElapsed`, `OperatorNoticeNotElapsed`) | every proposal | **ON-CHAIN.** |
| **ONE PROOF OF BURN, ONE VAULT, ONE WINDOW** | a charter claim outside `[charter_opens_at, charter_closes_at)`, with a Proof of Burn the signer does not own, or with an asset that is not one of the 240 addresses committed in `pob_root`. `programs/cbob-vault-mint/src/lib.rs` refuses `CharterNotOpen`, `CharterClosed`, `NotThePobOwner`, `NotInPobSet`, and burns the Proof of Burn by CPI in the same instruction | every charter claim | **ON-CHAIN.** |
| **THE POOL PAYS ONLY WHAT WAS DISTRIBUTED, ONLY INTO THE VAULT** | a claim paid anywhere but the vault's recorded cbBTC account, a distribution while an eligible vault waits to join, a redemption that leaves an owed share behind (unless the pool is frozen), a retire called from anywhere but BURN's `burn_vault`. `programs/cbob-vault-mint/src/lib.rs` refuses `WrongVaultAccount`, `VaultAccountMissing`, `JoinWaitingFirst`, `ClaimBeforeBurn`, `NotFromBurn`, `WrongPool` | every distribution, claim and redemption | **ON-CHAIN.** |
| **THE ONE-TIME WIRING IS RIGHT OR NOTHING STARTS** | an `initialize` by anyone but Gary's wallet, a collection that arrives with a plugin or already minted, a default 15% destination, a payment mint that is not a SEAL reserve, a SEAL/MINT/BURN/GOV naming different collections, a tighten bound outside its absolute range. `programs/cbob-vault-mint/src/lib.rs` refuses `NotTheInitAuthority`, `CollectionNotClean`, `WrongTreasury`, `PaymentMintNotAReserve`, `WiringDiverged`, `BadSweepBound`; `programs/cbob-vault-burn/src/lib.rs` refuses `WiringDiverged`; `programs/cbob-vault-gov/src/lib.rs` refuses `ForeignVault` | once, at launch | **ON-CHAIN.** |
| **`bank/crank.mjs`** — layer one of the three-layer fallback | a reveal nobody captured, a vault nobody activated, a month nobody distributed, a claim nobody delivered. Every instruction it sends is permissionless and pins its own destination; its key pays fees only and is refused above 0.25 SOL. **Installed DRY-RUN**; `--live` on its line arms both lanes | every minute (reveals), hourly (the rest) | **AUTOMATIC.** `bank/crank.mjs`, cron, installed by `scripts/cron-install.sh`. |
| `detectDistributionOverdue` / `detectPoolHealth` / `detectBrakeTransitions` (alarm, EVERY pass) | a payout all three layers failed to run, a frozen or short pool, a brake pulled or released, a guardian or swap operator armed, a reschedule, a frozen claim, redemptions near the rolling-hour cap, any plugin or update-authority change on the Proof of Burn collection, a program still upgradeable past the lock date | post-hoc, ≤30 min | **AUTOMATIC.** `bank/alarm.mjs`, cron, installed by `scripts/cron-install.sh`. |
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

1. **(prior transaction)** create the destination token accounts. A 3-asset
   redemption that also creates them does not fit one legacy transaction
   (stage 3 measured 2 mints only), so this step is separate.
2. **(the redemption)** `claim` this vault's credited share into it, then
   `open_for_redemption` (SEAL), the sweeps (Core `ExecuteV1`, the owner's own
   instructions), and `burn_vault` (BURN), which checks the rolling-hour cap,
   proves emptiness, burns the asset through Core, retires the vault from the
   payout schedule by CPI into MINT's `retire_redeemed` (refusing
   `ClaimBeforeBurn` if a whole sat is still owed, UNLESS the pool is frozen, in
   which case the undelivered share returns to the pool and the redemption lands,
   logged `CBOB_REDEEMED_POOL_FROZEN`), and counts it in `burned_total` for live
   supply. A due monthly distribution then runs in-line, after the vault has left,
   so it credits only the vaults that remain.

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
reports any of the four still upgradeable past `CBOB_LOCK_DEADLINE` at CRITICAL
(`program_not_locked`). Every `initialize` below is gated on a compile-time
`INIT_AUTHORITY` (Gary's wallet), runs once (the config is an `init` PDA), and is
the only write some of these configs ever receive. There is no admin and no
`update_*` instruction in any program.

**SEAL** `9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273`
- `initialize(collection, reserve_mints)`: 1 to 3 reserve mints, every one
  passed as an account and owned by classic SPL Token (see "Token-2022 is refused"
  below). Production must pass all three (cbBTC, $GARY, $GIRAFFISH): nothing can
  add one afterwards.
- `open_for_redemption`: the OWNER signs. Walks the instructions sysvar and
  REFUSES to thaw (`NoTerminalBurn`) unless **`cbob_vault_burn::burn_vault` for
  the same asset and owner** appears later in the same transaction.
- That is the whole program. **There is no `close_redemption`** (removed in v5,
  see "Unbreaking is burning") and no `update_config` (removed in v6).

**MINT** `Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo`

| who may call | instruction | what it does |
|---|---|---|
| `INIT_AUTHORITY`, once | `initialize(bank_treasury, swap_operator, guardian, sol_reserve_lamports, max_supply, max_sweep_lamports, sweep_cooldown_secs, level_caps, payment_mint, pob_collection, pob_root, charter_opens_at, charter_closes_at, monthly_secs, notice_secs, sweep_floor_lamports, cooldown_ceiling_secs, reserve_ceiling_lamports)` | fixes the 85/15 split (`split_bps` = 8,500, not a parameter), the 15% destination, the pool (derived, not a parameter), `max_supply`, the level census, the charter window, the Proof of Burn root, every period and every bound; sets governance to GOV's `["gov"]` PDA (derived, not a parameter); refuses a collection that is not clean, not ours, or already minted; installs the collection's Royalties plugin at 10% with plugin authority NONE; refuses unless SEAL already names the same collection and holds `payment_mint` as a reserve |
| the owner (+ payer) | `mint_vault(name, uri, max_price, attributes)` | a vault in a VOTED round, paid in cbBTC into the revenue address; refuses while sales are stopped |
| the owner (+ payer) | `claim_charter_vault(name, uri, attributes, pob_proof, pob_extra)` | a free vault for one Proof of Burn, burned by CPI, inside the charter window only; NOT gated by the guardian's stop |
| anyone | `capture_entropy`, `reschedule_reveal`, `reveal_level(attributes)` | the level draw (see "The level") |
| anyone | `activate`, `distribute(burn)`, `claim(crank_n)`, `retire_burned` | the community pool (see below) |
| BURN's `burn_vault`, by CPI only | `retire_redeemed` | takes a redeemed vault off the schedule |
| anyone | `split_revenue(decimals)` | the enforced 85/15, cbBTC only |
| the swap operator | `sweep_sol_for_swap(amount)` | royalty SOL to the operator, capped, cooled down, above a reserve |
| the guardian | `emergency_stop_sales`, `emergency_stop_sweep`, `cancel_swap_operator` | one-way stops |
| governance (a ratified GOV proposal, by CPI) | `set_round(opens_at, closes_at, price, cap)` | price >= 21,000 sats (`PriceBelowFloor`), cap > 0, window at most a year |
| governance | `restart(sales, sweep, proposal_created_at)` | lifts a stop, refusing `StopIsNewer` for a vote created before the stop |
| governance | `tighten_sweep(args)` | sweep bounds, tighter only, never past the `initialize` bounds |
| governance | `arm_swap_operator(operator)`, `arm_guardian(guardian)` | arms a replacement; nothing changes yet |
| anyone, after `notice_secs` | `apply_swap_operator`, `apply_guardian` | lands the armed key (or, for the guardian, `None`: the brake retired) |

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
  `charter_closes_at` has passed** (`CharterNotClosed`). Up to four actions, at
  most one of each kind: `SetRound`, `Brakes` (restart sales and/or the sweep,
  and/or arm a new guardian or `None`), `TightenSweep`, `ArmSwapOperator`. A guardian
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
  YES >= ceil(50% of the snapshot), i.e. half of ALL live vaults
  (`KeyChangeNeedsHalf`). Each action is a CPI into MINT signed by the `["gov"]`
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
versions: SEAL config 2, MINT config 5, BURN config 4, GOV config 3, VaultRecord 3.
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
| 2. swap SOL → cbBTC (Jupiter) | **OFF-CHAIN — the one trusted hop** | the swap operator key |
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
| swap operator (transient only) | none | `3QwQnwkrRE2qwxLBsQCMKLfSaQtAHZkx9ugvuyWpxCfe` (the intended key: it is an `initialize` argument and is not pinned in code) |

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
  revenue. It costs 200 $GARY and a funded, revealed vault; the crank splits every
  pass, which bounds the unsplit balance to about an hour of sales. Put to Gary
  2026-10-03 (accept as a limit, or move the split in-line on chain).
- **When nobody has joined yet but vaults are waiting** (launch), only the FREE
  monthly path, once due, may run, and it credits nothing: it only advances the
  epoch so they can join (logged `CBOB_EPOCH_TICK`). The 100 $GARY path refuses
  (`NoActiveVaults`), so a first activator cannot open the door alone. The
  monthly clock starts at `max(initialize time, charter_closes_at)` (red-team 3
  finding 5), so that first tick cannot land inside the charter window.

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
undrawn, and never decreases. (Raising a level one step by burning $CBOB is part
of the ruling and is **not built**; DESIGN-v6 section 3 requires it to settle the
claim and adjust the weight in the same instruction when it is.)

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

**A Level V vault receives exactly three times a Level One. Not sixteen.**
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
- **If every vault is redeemed, no proposal can ever be created again** (a
  proposer must show a live vault). With immutable programs and no admin that is
  final. Red-team 2 finding 7, accepted (accepted limit 45).
- **The 7-day proposal execution deadline is NOT exercised by the test suite**,
  for the obvious reason (it is a constant, not an `initialize` value). Its
  sibling, that a round already over is skipped rather than installed, is tested
  end to end (3c.R1).
- **`--reconcile` cannot be integration-tested locally**: it needs DAS and a real
  cluster, and the test validator has neither. Its JUDGEMENT is a pure detector
  proven both ways; only the I/O is untested, and that is why it is said here.
- **1 lamport griefs a burn — but only until the next redemption.** Anyone can
  send lamports to the derivable asset-signer PDA, and `burn_vault` refuses on a
  non-zero balance. The owner sweeps them inside the SAME redemption (measured,
  9.10/9.11), so it costs the griefer their lamports and costs the holder one
  extra instruction. The check cannot be dropped (see proven impossibility 4).
- **The reserve list is a HARD CEILING of three, measured.** A redemption is one
  transaction (claim, open, every sweep, the burn), so transaction size bounds the
  product. Until round 13 `MAX_RESERVE_MINTS` was **8**, a Borsh bound standing
  where a packet bound was needed: in v5 one ordinary admin `update_config` could
  have added mints until no redemption fit and sealed every vault irreversibly.
  v6 writes the list once at `initialize`, and the bound still guards that write.

  Measured (9.14) by building the real **worst case** — every reserve swept AND
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
  is the most that fits and that both constants agree with the measurement, so
  raising one without re-measuring turns the suite red. **A fourth reserve mint is
  not possible**: no instruction adds one, and it would need a versioned
  transaction, an address lookup table and a client that builds one, none of
  which exist. 9.13a pins the measurement's own foundation — that an unsigned
  serialization already reserves the 64 bytes per signature.

  ⚠️ **AND ONLY TWO FIT IF THE REDEEMER MUST CREATE THEIR DESTINATION ATAs**
  (measured, 9.14b and, with the claim, 9.14d; v5 read 1 -> 991, 2 -> 1215,
  3 -> over). A first-time redeemer does not own an ATA for each reserve mint.
  **Creating them is not required to be atomic with the burn — unlike the sweep —
  so it MUST be a prior transaction.** That is an operational requirement on any
  redemption client (accepted limit 42).

  **COMPUTE UNITS ARE MEASURED, AND THE FEAR WAS THE WRONG WAY ROUND.** This
  paragraph read "compute units are NOT measured anywhere" for nineteen rounds.
  Measured on the artifact (`meta.computeUnitsConsumed` off landed transactions,
  not a simulation, v5): a plain mint is 58,956 CU / 890 bytes, and the widest pad
  the packet allows is 18 instructions at 73,657 CU, leaving 1.33M of the 1.4M
  cap. At 816.7 CU per padded instruction, exhausting compute would need roughly
  1,700 padding instructions, about 32,000 bytes of transaction. **The byte wall
  binds more than twenty-five times before the compute wall.** Assertions
  10.1-10.4 pin it on the v6 build, including a deliberately generous 400,000 CU
  regression ceiling. See ACCEPTED LIMITS, item 12/17, DISCHARGED.
- **A PDA owner cannot redeem**, so `mint_vault` and `claim_charter_vault` require
  the owner to sign. This makes bulk issuance to absent members impossible by
  design, and a DAO or multisig cannot hold a vault usefully (accepted limit 43).
- **The upgrade authority is REMOVED at launch** (v6, Gary's ruling: immutable).
  Until it is, whoever holds it could replace a program and "no key can unseal a
  vault" would be false by one indirection; the alarm reports any of the four
  still upgradeable past `CBOB_LOCK_DEADLINE`. (v5's plan was to move it to a
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
window lapses. (v5 text named `detectDistribution`'s `distribution_unfinished`,
which was deleted with `bank/distribute.mjs`.)

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
*Who:* the holder, to their own property. *Why not fixed:* the chain cannot
enumerate what a PDA owns (proven impossibility 2), and continuous detection
needs a per-vault DAS owner search every pass. See also item 44.

#### The swap hop (`bank/revenue.mjs`, MINT `sweep_sol_for_swap`)

**10. (v6 restated) The swap operator is the one trusted hop.** Royalty SOL is
swept on chain to a long-lived operator key and swapped to cbBTC off chain; mint
prices are cbBTC and never touch it. *Costs:* the operator (or a thief of its
key) can keep the SOL: per-sweep cap x cooldown windows until the guardian
pulls `emergency_stop_sweep`, never more than the revenue PDA holds above the
reserve. *Who:* holders and the Squads, of royalty revenue only. *Why not
fixed:* there is no trustless SOL->cbBTC without a DEX CPI. What v6 adds: the
operator must sign, a vote can only tighten its bounds and only inside the
`initialize` bounds (1 SOL, 24 h, 0.1 SOL ruled), a replacement needs half of
all live vaults plus 7 days' notice, and the guardian can stop the sweep and
cancel a pending replacement. Recorded in "Known limits" as a design
consequence too, because it is both.

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
program still upgradeable past `CBOB_LOCK_DEADLINE`. **BUYER-FACING.**

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
And a window that lapses with NOBODY calling reschedule logs nothing at all, so
the alarm now also pages when the level queue does not move between two passes
(`reveal_queue_stalled`). **BUYER-FACING.**

**26. THE LEADER OF THE LAST ENTROPY SLOT CAN STILL GRIND ITS OWN BLOCK.** The draw
hashes three slot hashes from three different leader rotations (A at or after the
reveal slot, B and C each two 4-slot groups later; alignment measured on mainnet).
That removes every other leader's influence, but C's leader produces its block
KNOWING hA and hB and may vary its contents. ⚠️ Round 22 corrected "(or skip,
handing C to the next leader)": B and C target the FIRST slot of a 4-slot leader
group, so a skip by C's leader moves C to that SAME leader's next slot, and the
leader schedule is public, so a validator can time a mint (or a reschedule) to
put C inside its own rotation. Being C's leader is chosen, not a stake-share
lottery. *Costs:* a validator that is C's leader can bias the draw within one
slot's time, and ⚠️ (round 22) **not just one vault's**: every vault minted in the
same slot shares the same `reveal_slot`, so the same three hashes, so C's leader
biases that whole cohort at once (each vault still mixes its own asset address
into the hash). *Who:* the census, as in 25. *Why not fixed:* the last
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
`retire_burned` returns whatever was not yet claimed to the pool.

**28. Coinbase can freeze cbBTC accounts, including the POOL.** A frozen VAULT
account is skipped by `claim`, logged (`CBOB_CLAIM_DEFERRED_FROZEN`) and stays owed
in full (P.18), and ⚠️ (round 22) it also blocks that vault's WHOLE redemption,
its $GARY and $GIRAFFISH included: BURN requires every reserve account empty and a
frozen account cannot be emptied. The alarm pages `vault_account_frozen` (it reads
every reserve account's state each pass). A frozen POOL stops every claim (joins
still go through) until it is thawed. Since stage 3c
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
limit is stricter, never looser. Proven at a short window; the 3600 s value is
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
pool, or finds an eligible vault still waiting to join, and a month with NO
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
**BUYER-FACING.**

**40. Metaplex Core is upgradeable by Metaplex.** Every seal, thaw, sweep, burn,
Execute and level write is a CPI into Core. A Core upgrade that changes
`UpdatePluginV1`, `ExecuteV1`, `BurnV1` or the plugin rules reaches every vault,
and our immutable programs cannot adapt. *Why not fixed:* not ours. The alarm
watches `prog.core.upgrade_authority` and `prog.core.hash`; it detects, it cannot
prevent. **BUYER-FACING.**

**41. A leaked custodial key is bounded only by the 2.1%/hour REDEMPTION cap, and
transfers are not limited.** The cap was built so that if Gary Club custodial
keys leaked, a thief could not empty every vault faster than we could move them
to fresh keys. It does that for redemptions. A thief holding the keys can instead
TRANSFER every vault to their own wallet at once, then redeem at the cap, or simply
keep or sell them (red-team 2 finding 4). *Who:* custodial holders. *Why not
fixed:* Gary kept the cap (RT2-4) for what it does bound, and an unlimited
transfer is also what lets custodial vaults be moved to fresh keys. The holder
copy must not claim the cap stops a key thief. **BUYER-FACING.**

**42. A redemption of a vault holding all three reserve assets needs the
destination ATAs created in a PRIOR transaction** (9.14b, 9.14d: only two fit
when created in the same one). A client that folds the creation into the
redemption fails. *Who:* any redemption client. *Why not fixed:* the packet.

**43. An off-curve owner (a DAO, a multisig, a program) cannot redeem.** The
pairing needs the owner's signature on two top-level instructions, which a PDA
cannot give. ⚠️ Round 22 corrected "nothing on chain can refuse an off-curve
owner at mint": `is_on_curve` panics on BPF, but requiring `mint_vault` to be a
TOP-LEVEL instruction (the stack-height check `retire_redeemed` already uses)
would force the owner to sign the transaction, which only an on-curve key can.
The cost is that no program could mint a vault by CPI. Not built; an owner
decision, and only possible before the lock. The alarm reports any vault owned off-curve as
`unredeemable_owner` at CRITICAL; a marketplace escrow can look the same and is
recoverable. **BUYER-FACING.**

**44. Undeclared airdrops and nested vaults are DESTROYED on redemption.** The
three reserve assets are checked on chain every time; anything else a vault's PDA
holds and the burn is not shown dies with the asset (9.5/9.6, 9.9). In v5 the
Bank refused such a redemption; in v6 only the redeem page's
`judgeRedemptionCoverage` can warn before the owner signs, and that page is not
built (item 50). Post-hoc, the alarm reports undeclared token accounts daily
(`--reconcile`) and nested vaults every pass. *Who:* the holder, to their own
property. **BUYER-FACING** (the holder guide tells holders to send only the three
reserve assets).

**45. If every vault is redeemed, governance can never act again** (a proposer
must show a live vault, and nothing else can create a proposal). Red-team 2
finding 7, accepted: with no vaults there is nothing left to govern but sales,
and immutable programs with no admin cannot be rescued.

**46. The Giraffish Moments collection's update authority is a HOT wallet, kept by
ruling, and a REJECTING hook there still blocks every charter claim.** A Proof of
Burn is one of 240 assets in that shared collection, and its update authority is
the Gary Club inventory hot wallet (Gary, RT2-1: "we keep it and it will stay
secure"). Whoever holds it can add an external plugin that Core consults on every
burn. Mitigations that shipped: `claim_charter_vault` passes up to 8 extra
accounts through to Core's burn of the Proof of Burn (never as signers), so a
benign or approving hook cannot brick the claim (tested against a real Core
Oracle plugin), and the alarm pages on ANY plugin or update-authority change on
that collection. ⚠️ Round 22: the alarm watches the COLLECTION account, not each
of the 240 assets, so a plugin added to an individual Proof of Burn is not paged
(the same hot wallet is the only key that can add one). What remains: a hook that
REJECTS still refuses every claim, in a
window that can never reopen. *Who:* every charter member. **BUYER-FACING.**

**47. A stolen guardian key can hold sales and the sweep shut for about a vote
plus a week, repeatedly.** The guardian can only stop, so a thief can stop sales
and the sweep, and stop them again after every restart vote, and cancel any
swap operator a vote arms. It cannot touch a vault, a payout or a rule. The cure
is a vote that replaces the guardian: YES from half of ALL live vaults, never
bundled with a swap-operator change, landing only after 7 days' notice, which the
guardian in office cannot cancel. *Why not fixed:* that delay is what stops a
captured vote removing the brake in one breath (red-team 2 finding 2). A guardian
of `None` is legal, so the holders can also retire the brake by the same rule.

**48. The charter claim cannot be stopped.** By ruling ("no pause during that
round") `claim_charter_vault` does not read the sales stop, so a bug in the
charter path runs for the whole 7-day window. *Why not fixed:* a stop there could
cost a charter member their claim for good, because the window can never reopen.

**49. A vault's record rent is not refunded.** Each vault's `VaultRecord` (221
bytes, 2,429,040 lamports, paid by the minter) is never closed, by design (see
"The community pool"). DESIGN-v6 once promised a refund; red-team 2 finding 7
caught it and the design was corrected rather than the code.

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
`scripts/pob-set.json` (its selftest, 22 launch assertions behind a floor in
`run-tests.sh`, proves each kind of refusal). Still OPEN: the charter opening date
(Gary) and the swap operator key; PROPOSED, not ruled: the sweep cap, cooldown and
SOL reserve.

**50. THE SURFACES PROMISED TO HOLDERS ARE NOT BUILT.** The holder guide says the
redeem page checks a vault for anything that would be destroyed and warns before
the holder signs, and offers to trigger (and join) a payout first; and that every
opening is announced on X and the CBOB website. A redemption client must also
create the destination accounts in a prior transaction (item 42) and put `claim`
before the sweep. None of that exists: `judgeRedemptionCoverage` is a pure
function with no page, and `bank/redemption-poster.mjs` drafts posts and has no
sender (an automated new post on @cbobtc needs Gary's go-ahead and the website
surface is not chosen). v6 removed the only other pre-signature check (the Bank),
so until the page exists items 9 and 44 have no preventive control at all.
(Classified OPEN AND BLOCKING by this edit because the guide promises it; Gary
may rule otherwise.)

**51. LEVEL-UPS BY BURNING $CBOB ARE NOT BUILT, AND CANNOT BE ADDED AFTER THE
LOCK** (round 22, D5). DESIGN-v6 section 3 and this file mention them as "not built
yet". With no upgrade authority, a feature not in the deployed bytes never exists.
Either it is specified (how much $CBOB per level, whether it respects the census
caps, how it settles the vault's claim and weight in the same instruction) and
built and audited before the lock, or it is struck from the design and from
everything holders read. Asked of Gary 2026-10-03.

**52. THE POOL'S AND THE SQUADS' cbBTC ACCOUNTS MUST EXIST BEFORE THE FIRST
SPLIT, AND THE REVENUE ADDRESS MUST HOLD RENT** (round 22, S5 and F26). The CBOBTC
Squads address `bc92Z…` was verified on mainnet 2026-10-03 to be a Squads VAULT
(off-curve, no account of its own) whose cbBTC ATA already exists. The revenue
address starts at 0 lamports, so a first royalty smaller than rent exemption
would fail: fund it above rent at launch. `initialize` only DERIVES the pool address; nothing creates
the token account, and `split_revenue` needs both it and the CBOBTC Squads' cbBTC
ATA. Until both exist every split fails (loud: `pool_unreadable`,
`revenue_unsplit`). Road step 10 creates both, idempotently, right after
`initialize`.

**53. A DRESS REHEARSAL AT THROWAWAY PROGRAM IDS CANNOT RUN THE SHIPPED OFF-CHAIN
CODE UNCHANGED** (round 22, from a disqualified report, verified): the program
ids are constants in `bank/layout.mjs`, `bank/revenue.mjs` and
`bank/detectors.mjs` (and in `bank/alarm.mjs`, `bank/selftest.mjs`, the four
programs' cross-references, the tests and the sim). **ADDRESSED by a recorded patch,
not by changing the audited code:** `scripts/rehearsal-tree.sh` makes a detached
worktree of HEAD outside the repo, generates four throwaway program keypairs, and
applies exactly five substitutions (the four ids and the repo root path, so the
rehearsal's keys, locks and caches never touch production's). It then PROVES the
patch is only that: reversing the map recreates every file of HEAD byte for byte,
git's own diff names the same files, and all four programs plus `bank/layout.mjs`
were patched. No derived address (config, pool, mint authority PDA) is hard-coded
anywhere in the code, measured 2026-10-04 by deriving our PDAs under every seed we
use and checking every off-curve literal, so the ids are the whole patch. It writes
`REHEARSAL-RECORD.txt` (commit, map, patch sha256). It never builds or sends. **Proven
2026-10-04 at `d57ee3a`: the FULL `scripts/run-tests.sh` passes inside the
rehearsal tree at throwaway ids** (655 on-chain, 498 detectors, 31 accrual, 24
mainnet, every gate). Its first run caught the one thing a byte-exact reverse
cannot: a selftest regex written as an ABBREVIATED id, now fixed, and the script
refuses any leftover 4+ char id prefix.

**54. COMPUTE AT THE WIDEST HOST SHAPES: MEASURED 2026-10-04, AND IT BINDS THE
HOLDER PAGES** (round 22, D7; suite arms 10.5, 10.6, 10.6a, simulated so nothing is
consumed). One capture walks the full 512-entry SlotHashes three times and costs
**114,598 CU**. A plain mint costs 70,686; a mint carrying the full crank of 4 due
captures costs **518,929**, inside the 1,400,000 transaction maximum but REFUSED
under the default 200,000 budget (10.6a proves the default refuses exactly when the
measured cost says it should). Even one piggybacked capture leaves a mint at about
185,000, a few percent under the default, and a charter claim is heavier than a
mint. Early in a fresh validator's life SlotHashes is short, which is why the
suite's own one-capture claims never hit this. Consequences:
  * **The bank's crank is unaffected**: it sends each capture as its own
    transaction (114,598) and each reveal alone (145,082 with its inline capture).
  * **Holder pages (item 50) must set the compute-unit limit on ANY transaction
    carrying a crank**: host cost + 115,000 per capture + margin, and MAX_CRANK is 4.
    A page that cannot rely on the wallet keeping its compute-budget instruction
    sends NO crank; the crank lane captures within a minute anyway.
  * A claim batch costs about 4,000 CU per vault (P.31: 6 vaults, 29,192), so the
    crank's 14-vault batches sit near 60,000, far under the default (extrapolated
    from the measured per-vault cost, not measured at 14).
  * Not changed on chain: a binary search over SlotHashes would make captures
    cheap, but it rewrites the entropy reader during the freeze to save holders a
    compute-budget instruction. Recorded as an option, not taken.

---

### DISCHARGED: measured closed, or gone with the thing it was about

**12 / 17 — compute units.** Was: "unmeasured anywhere; there may be a CU ceiling
below the 1,232-byte ceiling", promoted to release-blocking after five auditors
across rounds 18 and 19. **MEASURED on the artifact** (`meta.computeUnitsConsumed`
off landed transactions, not a simulation): a plain mint 58,956 CU / 890 bytes;
the widest pad the packet allows is 18 instructions at 73,657 CU / 1,228 bytes,
leaving 1,326,343 CU of the 1,400,000 cap. At 816.7 CU per padded instruction,
exhausting compute would need roughly 1,700 padding instructions — about 32,000
bytes of transaction. **The byte wall binds more than twenty-five times before the
compute wall**, so a transaction that fits cannot run out of compute on this path. The fear was the wrong way round. Assertions 10.1–10.4, including a
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
| `bank/crank.mjs` | layer one of the three-layer fallback (ours, then anyone's permissionless call, then ordinary traffic doing it in-line). Every minute: reschedule, capture, reveal in mint order. Hourly, in this order (red-team 3 finding 6): the same, then retire bare burns, JOIN every eligible waiting vault, the free monthly distribution, activation requests at 21,000 sats, claims in batches of 14 (skipping frozen accounts and never paying or joining a positively burned vault). Permissionless instructions only; its key pays fees and is refused above 0.25 SOL. `MonthNotElapsed` on its own distribute is logged as done (traffic ran the month), not a failure | only where the program already sends it; installed dry-run |
| `bank/alarm.mjs` + `bank/detectors.mjs` | every 30 minutes: approvals, PDA token accounts, burns, balance falls, nested vaults and off-curve owners, config and program drift (including the PoB collection's plugins and update authority), launch values that are not the ruled ones, an overdue distribution, the pool (frozen / short / unreadable), redemptions near the rolling-hour cap, the brakes (pull and release, URGENT), an armed guardian or swap operator, reschedules and frozen claims (attributed by the invoke stack, URGENT), a program still upgradeable past `CBOB_LOCK_DEADLINE`. Daily `--reconcile`: what each vault PDA owns. A dead-man's switch pages if the alarm's state goes stale | no |
| `bank/lock.mjs`, `bank/sigwalk.mjs`, `bank/spl.mjs`, `bank/anchor.mjs` | shared helpers: the flock wrapper and ledgers, the signature walk, token-account reads, pinned Anchor account reads | no |
| `bank/accrual.mjs` | the program's payout arithmetic mirrored in BigInt, for the crank and the alarm | no |
| `bank/revenue.mjs` | the one trusted hop: royalty SOL -> cbBTC -> split. Mint prices arrive as cbBTC and need no swap | yes, opt-in `--live` |
| `bank/redemption-poster.mjs` | drafts the public post for every redemption. **No sender** — needs Gary's go-ahead and a website surface | no |

**A read that fails is an alarm, never a pass**, and every v5 rule that enforced
that survives: a missing state file is not day one, a cursor the cluster cannot
resolve is a CRITICAL, an undelivered finding keeps every baseline, the
dead-man's switch watches the watcher, and a dry run consumes nothing.

## Where this stands, honestly

**v6 as of 2026-10-03.** Programs built through stage 3c; the off-chain pipeline
through stage 4; `./scripts/run-tests.sh` green end to end at the counts in
"Running the tests". Red-team 3 (`audits/v6-redteam/RT3-stage3c.md`) found **no
CRITICAL or HIGH** and one MEDIUM plus six LOW, all fixed in stage 3c (one LOW
fixed in the crank and accepted on chain, item 27). The Test Vault simulation
(`sim/`, one vault's whole life against real mainnet Core and the real cbBTC,
$GARY, $GIRAFFISH mints and two real Proof of Burn assets, cloned) is built; its
results are pending. **Nothing is deployed, nothing has minted, nothing holds real
value**, and the freeze counter is at zero (`audits/FREEZE.md`): v6 is the version
that must earn the two clean rounds.

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
bounded governance, the rate limit), which has had three single-agent red-team
passes and no multi-model round yet.

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
   vaults) or anything fixed at `initialize`.
5. **The surfaces promised to holders and the launch values** (items 50 and 38),
   both open. v6's Bank duties are gone: the vote snapshot and the charter
   claim's Proof of Burn burn are on chain now.

## THE SHIP GATE

> **RULING, Gary 2026-08-22: there will be NO human audit firm. This system is
> audited by AI or not at all.**

Every earlier version of this document leaned on a professional firm reviewing a
frozen version. That backstop is gone, so the AI process now carries the whole
weight and its three structural weaknesses have to be answered rather than
deferred. Named, with what answers each:

| what an AI round structurally cannot do | what answers it here |
|---|---|
| **It reasons; it never executes.** ~1/3 of "CRITICAL" findings across nineteen rounds were WRONG on measurement. | The 655 assertions, real cloned Core suite runs against **real mainnet Core cloned onto a validator**, minting real vaults and moving real tokens. It is what has disproven every wrong claim. |
| **It sees only the bundle.** Rounds 11 and 12 both produced their worst findings in files no auditor had seen, and five files had escaped **thirteen** rounds. Round 19 then asked auditors about three files it had not put in either bundle, which produced two confident wrong findings. | `scripts/audit-coverage.sh` diffs every audit prompt ever sent against the file tree and fails if anything has never been read, and the runner refuses to name a file it did not deliver. |
| **Every round audits code the last round could not see, so rounds never converge.** | The FREEZE below. Without it the stopping condition is unreachable by construction, which is why it was met zero times in twenty-one v5 rounds. |

**All five must hold at once. Any commit to `programs/`, `bank/` or `scripts/`
resets 2 and 3 to zero.**

1. **Coverage.** `scripts/audit-coverage.sh` exits 0 — no file has escaped every
   round.
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
| 5 | Test Vault simulation (`sim/run-sim.sh`, `sim/test-vault.ts`) | **done, 59/59** (every refusal pinned to its reason). It found one fixture artifact worth knowing: mainnet's rent rate is now LOWER than the test validator's, so cloned accounts are topped up to local rent (asserted rent-exempt on mainnet first) |
| 6 | Launch values decided (item 38) and holder surfaces built (item 50); not a numbered step in DESIGN-v6's build order, placed here because both must exist before anything mints. Independent of the freeze and the audit rounds, so it runs beside them | **values in `launch/mainnet-init.json`, refused by `scripts/check-launch-params.mjs` until complete**: all ruled except the charter opening date (Gary) and the swap operator key (generated at launch); the sweep cap, cooldown and reserve are PROPOSED (10 SOL, 6 h, 0.05 SOL). Holder surfaces open |
| 7 | FREEZE, then two consecutive clean AI audit rounds with different rosters (gates 1-5 above) | not started |
| 8 | Mainnet dress rehearsal: throwaway program ids, small real amounts, the crank and alarm live (item 22) | not started |
| 9 | Deploy; verify the deployed bytes against `scripts/build-mainnet.sh`'s sha256 | not started |
| 10 | `initialize` all four programs with the ruled values, SEAL first (MINT and BURN refuse a SEAL that is not there; GOV refuses without MINT). It needs only `INIT_AUTHORITY`, not the upgrade authority | not started |
| 11 | **Remove the upgrade authority from all four programs.** After this nothing can be fixed (item 39) | not started |

Nothing is deployed and nothing has minted.

⚠️ **THIS PARAGRAPH SAID "THIRTEEN" UNTIL PHASE 1, AND SO DID THREE ROWS OF THE
TABLE ABOVE, AND THE SUITE SIZE BESIDE THEM SAID 270 AGAINST A REAL 311.** Six
rounds of findings had landed underneath a section describing the process that
found them. The stated-count gate in `bank/selftest.mjs` read exactly ONE
occurrence of each of three floors, so every one of these was invisible to it.
It reads EVERY occurrence of all five now.

The pattern that keeps producing findings is nameable now: **a fix is a change,
and a change is a place a defect can live.** Its most common shape here is a fix
applied to one of two identical sites, which has happened in five rounds running.

## Running the tests

```bash
./scripts/run-tests.sh          # 655 assertions, real cloned Core, real SPL tokens
                                # (+ 498 detector, 31 allocation, 22 poster,
                                #  14 Proof-of-Burn, 22 launch and 24 live-mainnet
                                #  assertions, run by the same script, each behind an
                                #  assertion FLOOR that must EQUAL its count: an exit
                                #  code cannot tell "all passed" from "stopped early
                                #  and passed what it reached", and a floor that only
                                #  bounds below accumulates slack)
                                # THESE NUMBERS MOVE WITH THE FLOORS IN
                                #  scripts/run-tests.sh AND bank/selftest.mjs, and
                                #  bank/selftest.mjs checks EVERY occurrence here.
./sim/run-sim.sh                # the Test Vault: 60 simulation assertions, floor SIM_FLOOR
./scripts/build-mainnet.sh      # mainnet artifacts + proof of which key shipped,
                                # for ALL FOUR programs, with the git commit recorded
                                # and a dirty tree refused
node bank/accrual.mjs --selftest          # 31 allocation assertions: the program's payout arithmetic
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
