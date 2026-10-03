# Central Bank of Bitcoin Vaults — v10 spec (written FROM the implementation)

> ⚠️ **v6 (branch `v6`, 2026-10-03) IS BUILT THROUGH STAGE 4; PARTS OF THIS
> DOCUMENT STILL DESCRIBE v5.** v6 has **no Bank key** (the owner alone signs a
> mint or a redemption; the programs' rules are the second party), **no admin**, a
> **guardian** (Gary's wallet) whose only power is two ONE-WAY stops, governance
> that reaches only what may change, a community **pool** the MINT program pays
> out itself, levels **drawn after the mint** from slot hashes, a one-time
> **charter claim** against the 240 Proof of Burns, a fixed **10% royalty**, an
> on-chain **2.1%-per-hour redemption cap**, and INIT_AUTHORITY = Gary's wallet.
> Rewritten for v6 so far: THE OWNER ALONE, THE CONTROL TABLE, REDEEMING A VAULT,
> the off-chain pipeline, the community pool and distribution sections, the
> accepted limits and the test counts. Other sections that describe the Bank,
> admin, rotations or the co-signer describe **v5**; the design of record is
> `DESIGN-v6.md`.

> v1's spec and code disagreed in seven places and auditors flagged the drift as a
> finding in its own right — most dangerously `seal = ["seal", vault_asset]` in the
> spec vs a global `["seal"]` in the code, which would have bricked an entire
> collection at mint. Everything below is read off the source.

**NOTHING HAS MINTED. NOTHING HOLDS REAL VALUE.** Thirteen AI audit rounds have
each found something real, INCLUDING THE MOST RECENT — so the honest status is
that the process has not converged. See "THE SHIP GATE" at the end, which is now
the only thing that decides whether this holds Bitcoin.

Round 6 was the first to audit ALL FOUR programs together with the off-chain
`bank/` pipeline and the ops scripts. It was also the largest: the alarm's
transaction scanner turned out to be structurally dead after its first pass, the
"50 SOL cap" on the trusted hop existed only in a script that need not be the
caller, and admin alone could appoint itself governance in one instruction.

**Rounds 7 through 10 were aimed at the previous round's fixes, and most of what
they found were defects IN those fixes** — including a detector that would
have emailed a CRITICAL every thirty minutes while checking nothing, and a
quorum snapshot that froze the wrong direction. That is the most useful thing a
round can produce, and it is the reason each round is handed the previous
round's repairs and asked whether they are real or merely relocated. Verdicts on
every finding accepted AND rejected: `audits/round6/VERDICT.md`,
`audits/round6/VERDICT.md` through `audits/round10/VERDICT.md`.

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
| **the programs** | the seal (`["seal"]` PDA), the pool (the config PDA's cbBTC account), the level draw | cannot move a vault's contents — Core demands the owner's signature |
| **the guardian** (Gary's wallet) | two one-way stops | cannot restart anything, open a vault, move money or change a rule |
| **governance** (the vault holders' vote) | sale rounds, restarts, tightening the swap bot, replacing the guardian | cannot touch the 85/15 split, its destinations, the 2,100 cap or the 10% royalty (fixed at `initialize`) |

What the Bank's signature used to buy, and what replaced it:
- **The hot Bank key is gone**, and with it the 7-day halt on a lost key, the
  "must stay a plain keypair" constraint, the fee-payer gap and the Bank's
  control of the mint queue (accepted limit 24).
- **The owner's key IS the vault.** A thief holding it can redeem. The on-chain
  2.1%-per-hour bucket is what bounds a mass theft through leaked custodial keys,
  and the public post per redemption is what makes one visible.
- **The redemption preflight moved to the redeem page**, which is not built: see
  the control table.

### ⚠️ AND NEITHER CAN A VAULT'S OWNER. A DAO CANNOT HOLD A VAULT.

Round 14 (still true in v6). **Any address that cannot sign a
top-level instruction cannot redeem a vault it owns** — the pairing needs two
top-level owner signatures, and a program signs only by CPI. So a DAO buying a
charter vault from its Squads treasury pays real money, deposits real cbBTC, and
receives a permanently sealed asset.

**`mint_vault`'s `owner: Signer` does NOT prevent this**, and MINT's comment
claiming it is "strictly stronger" than an on-curve test is wrong: `is_signer` is
TRUE for a PDA passed as a CPI signer. Suite test 5.2 does not cover it either —
it passes the PDA with `isSigner:false` and is refused by `AccountNotSigner`,
which is a different property. Nothing on-chain can refuse it (`is_on_curve`
panics on BPF), so `detectNestedVaults` reports an off-curve owner at CRITICAL
(`unredeemable_owner`) and that detection is the entire control.

An off-curve owner may also be a marketplace escrow holding a listed vault, which
is recoverable. We do not yet know whether Core marketplaces escrow the asset or
use a transfer delegate, so the finding names both readings rather than guessing.

## UNBREAKING IS BURNING (v5, Gary's ruling 2026-08-22)

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
| **2.1% OF LIVE VAULTS PER HOUR** | a mass drain through leaked owner keys (Gary Club custodial wallets above all): a continuously refilled bucket of max(1, ceil(live x 2.1%)) redemptions per window. `programs/cbob-vault-burn/src/lib.rs` refuses `RateLimited`. Transfers are NOT limited, which is what lets custodial vaults be moved to fresh keys faster than a thief can open them | every redemption | **ON-CHAIN.** |
| **THE GUARDIAN CAN ONLY STOP** | the guardian (Gary's wallet) restarting anything, or anyone else stopping anything. `programs/cbob-vault-mint/src/lib.rs` refuses `NotTheGuardian`, `SalesStopped`, `SweepStopped`, and `StopIsNewer` for a restart voted before the stop it would lift | always | **ON-CHAIN.** |
| **NO LEVEL WITHOUT ENTROPY, IN MINT ORDER** | a draw out of order, or from a lapsed window. `programs/cbob-vault-mint/src/lib.rs` refuses `RevealOutOfOrder` and `NeedsReschedule` (a lapse is rescheduled, never defaulted) | every reveal | **ON-CHAIN.** |
| **A VOTE REACHES ONLY WHAT MAY CHANGE** | a proposal before the charter closes, a vote by a vault minted after the proposal, a pass on thin turnout. `programs/cbob-vault-gov/src/lib.rs` refuses `CharterNotClosed`, `VaultTooNew`, `TurnoutTooLow` | every proposal | **ON-CHAIN.** |
| **`bank/crank.mjs`** — layer one of the three-layer fallback | a reveal nobody captured, a vault nobody activated, a month nobody distributed, a claim nobody delivered. Every instruction it sends is permissionless and pins its own destination; its key pays fees only and is refused above 0.25 SOL. **Installed DRY-RUN**; `--live` on its line arms both lanes | every minute (reveals), hourly (the rest) | **AUTOMATIC.** `bank/crank.mjs`, cron, installed by `scripts/cron-install.sh`. |
| `detectDistributionOverdue` / `detectPoolHealth` / `detectBrakeTransitions` (alarm, EVERY pass) | a payout all three layers failed to run, a frozen or short pool, a brake pulled or released, a reschedule, a frozen claim, the 2.1% bucket nearly empty, a program still upgradeable past the lock date | post-hoc, ≤30 min | **AUTOMATIC.** `bank/alarm.mjs`, cron, installed by `scripts/cron-install.sh`. |
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
on-chain; this only concerns things that should not be in a vault at all.

### REDEEMING A VAULT (v6) — what the holder signs

No Bank, no co-signer, no sanctioned signing script: v5's `bank/cosign.mjs` and
`scripts/bank-sign.sh` are deleted. A redemption is the owner's own transaction:

1. **(prior transaction)** create the destination token accounts. A 3-asset
   redemption that also creates them does not fit one legacy transaction
   (stage 3 measured 2 mints only), so this step is separate.
2. **(the redemption)** `claim` this vault's credited share into it, then
   `open_for_redemption` (SEAL), the sweeps (Core `ExecuteV1`, the owner's own
   instructions), and `burn_vault` (BURN), which proves emptiness, retires the
   vault from the payout schedule by CPI (refusing `ClaimBeforeBurn` if a whole
   sat is still owed), counts it for live supply, and spends one unit of the
   2.1% bucket.

Anything credited by a distribution is delivered into the vault and swept out
with the rest. Revenue the pool holds but has not yet DISTRIBUTED is not the
redeemer's: a holder who wants their share of it triggers a distribution first
(100 $GARY, or wait for the month).

## The four programs, each with its own upgrade authority

> ⚠️ **v6 STAGE 3b SUPERSEDES THE MINT/GOV LISTS BELOW where they say admin,
> `update_wiring`, `set_paused` or `set_collection_royalties`.** There is no admin.
> MINT's governance surface is `set_round`, `restart` (refuses a restart voted
> before the stop), `set_guardian`, `tighten_sweep` (only tighter) and
> `arm_swap_operator` (+ permissionless `apply_swap_operator` after 7 days). The
> guardian has two one-way stops. The split, both destinations, `max_supply` and
> the 10% royalty are fixed at `initialize`. GOV proposals carry up to four
> actions, one per kind, are refused before the charter window closes, and need
> YES >= 10% of live supply. BURN rate-limits redemptions to `ceil(2.1% x live)`
> per window. `distribute` takes a 100 $GARY burn or the period, and the period's
> distribution also runs in-line in every host instruction. See DESIGN-v6.md
> sections 7-8 and ACCEPTED LIMITS 32-37. The text below is kept as the history
> it was written as and is not a description of v6.

**SEAL** `9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273`
- `initialize(collection, bank, reserve_mints)` — one-time, gated on a compile-time
  `INIT_AUTHORITY`. Every reserve mint account must be passed and be a **classic
  SPL** mint (see "Token-2022 is refused" below).
- `open_for_redemption` — owner + Bank sign. Walks the instructions sysvar and
  REFUSES to thaw unless **`cbob_vault_burn::burn_vault` for the same asset and
  owner** appears later in the same transaction.
- **There is no `close_redemption`.** It was removed in v5 — see "Unbreaking IS
  burning" below.
- `update_config(bank?, admin?, reserve_mints?)` — admin only. `collection` is NOT
  rotatable; reserve mints may be ADDED but never dropped.

**MINT** `Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo`
- `initialize(collection, bank, governance, treasury, max_supply)` — `max_supply`
  must be non-zero and ratchets DOWN only.
- `set_round(opens_at, closes_at, price_lamports, cap)` — governance only. `cap`
  must be > 0 (there is no unlimited sentinel) and the window is bounded to a year.
  **`price_lamports = 0` is legal on purpose: the charter round is free.**
- `mint_vault(name, uri, max_price_lamports, attributes)` — Bank co-signs, the
  **owner signs**, the payer states a price ceiling, and provenance is stamped at
  creation. Enforces the lifetime cap against `minted_total`.
- `update_wiring(...)` — admin. Anything that moves the holders' money —
  `treasury`, `bank_treasury`, `split_bps`, `swap_operator`,
  `sol_reserve_lamports`, the sweep bounds, the governance notice period —
  **additionally requires the governance signature.**
  **`governance` itself is ARMED here, never rotated here.** See below.
- `apply_pending_governance` / `apply_pending_admin` — permissionless, once the
  notice period has passed. `cancel_pending_governance` / `cancel_pending_admin`
  — the CURRENT admin, to disarm.
- `sweep_sol_for_swap(amount)` — **the swap operator SIGNS**; destination PINNED
  in config; **bounded on-chain by `max_sweep_lamports` AND
  `sweep_cooldown_secs`**, and `amount > 0`.
- `split_revenue(decimals)` — permissionless; the enforced 85/15.
- `set_collection_royalties(bps, add)` — admin **and** governance; bps ≤ 1000.
- `set_paused(bool)` — admin, immediate.

**BURN** `8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8`
- `burn_vault(declared)` — owner + Bank. Requires **a preceding
  `open_for_redemption` for the same asset and owner in the same transaction**,
  PDA lamports == 0, and every reserve mint's ATA (both token-program
  derivations) declared and empty. **The reserve list is read out of the SEAL
  config**, never kept locally.

### Rotating governance is a NOTICE PERIOD, not a signature

Round 6: `update_wiring` gated the treasury behind the governance signature and
then let **admin alone** write `config.governance`. Two transactions and one key
held both roles. Round 5's fix was relocated, not real.

The same instruction had the opposite defect in the intended wiring: once
`governance` IS the GOV program's PDA it can never sign an `update_wiring` at
all, so treasury, bank_treasury and split_bps become unrotatable. The requirement
was either trivially satisfiable or unsatisfiable, never in between.

So a rotation is now **armed, published, and applied later**:

| | |
|---|---|
| `update_wiring(governance: Some(x))` | admin. Writes `pending_governance` + `pending_governance_at`. **`config.governance` does not move.** |
| `apply_pending_governance` | anyone, after `governance_timelock_secs` |
| `cancel_pending_governance` | admin |

**`admin` goes through the same notice period, for the same reason and one more.**
Round 6 timelocked governance and left admin instantaneous — while
`cancel_pending_governance` is `has_one = admin`. One admin rotation therefore
took away the very remedy the timelock depends on, and the attacker could then
arm a governance rotation nobody could cancel. `pending_admin` /
`apply_pending_admin` / `cancel_pending_admin` close it.

**AND SO DOES EVERY OTHER ROTATION, IN EVERY PROGRAM.** Round 7 did MINT and
stopped, on the reasoning that a hostile Bank can only refuse. That was wrong:
the Bank's refusal is what stops a seller planting a delegate on a reserve ATA
during a thaw and then selling the vault, so a Bank the attacker controls is a
theft vector against secondary buyers. SEAL, BURN and GOV now have the same
arm / apply / cancel, and MINT's `bank` joined it. The Bank alarm reports any
armed rotation as CRITICAL **on its face, every pass** — a finding that fires
once fires while everyone is asleep.

### The governance gate splits by DIRECTION, not by field

Round 6 put every bound behind the governance co-signature — and the production
wiring makes that signature UNOBTAINABLE, because governance is a PDA that can
only ever sign a `set_round`. So replacing a compromised swap-operator key was
seven days away, with the attacker taking `max_sweep_lamports` every cooldown in
between. A control that cannot be used in the emergency it exists for is not one.

| admin alone, today | admin AND governance |
|---|---|
| rotate `swap_operator` | `treasury`, `bank_treasury`, `split_bps` |
| LOWER `max_sweep_lamports` | RAISE `max_sweep_lamports` |
| RAISE `sweep_cooldown_secs` | LOWER `sweep_cooldown_secs` |
| | `sol_reserve_lamports`, `governance_timelock_secs` (ratchets up) |

Rotating the operator cannot redirect anyone's money: the SOL it names is where
OUR SOL goes to be swapped, and every satoshi returns to the same revenue address
to be divided by the same enforced rule.

The escape hatch has to exist — a bug in GOV would otherwise freeze the round
forever — but it is slow and it is public. The Bank alarm reports a pending value
as CRITICAL **on its face, every pass**, not once when it changed, because the
whole value of a notice period is that somebody looks during it.

⚠️ `governance_timelock_secs` has a 60-second floor that exists ONLY so the apply
path is testable, exactly like `gov.min_voting_secs`. **The deployed value must
be days.** Unlike the voting period it RATCHETS UP, so a launch value set too low
is repairable. The alarm asserts it.

**GOV** `2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2`
- One vault, one vote. Standing is read live off the asset's owner bytes — no
  indexer, no snapshot. `VoteRecord` is a PDA at `["vote", proposal, ASSET]`, so a
  vault votes once per proposal **however many times it changes hands**.
- A ratified vote can do exactly one thing: CPI `set_round` on MINT. MINT
  independently bounds what a round may say and enforces the lifetime cap, so a
  hostile majority still cannot mint past `max_supply`.
- **The divisor is `max(snapshot, live supply)`.** Round 6 snapshotted it to stop
  minting lowering the bar mid-vote and froze the wrong direction: a proposal
  opened just after the ~190-vault charter round carried a divisor of 190 and
  could be executed a month later against 2,100 live vaults, where the 21% holder
  clears it alone. The bar now only rises with supply that really exists, and a
  mint can only make a proposal HARDER to pass.
- **The tally RULE is snapshotted into the proposal at creation** —
  `quorum_bps` and `threshold_bps` alongside the divisor. `execute_proposal` reads no config
  value for the tally at all. Round 6 froze only the divisor and left the RULE
  live, in the same round that made `quorum_bps` admin-lowerable: one signature
  and one vault could then ratify anything, atomically, and be reported half an
  hour later. A rule applied retroactively to votes already cast under a
  different rule is not a rule.
- **Execution only moves FORWARD** (`last_executed_id`). Each `set_round` resets
  `minted_this_round`, so an older ratification replayed after a newer one both
  revives a superseded price and hands the round its cap again.
- Quorum uses CEILING division and can never be zero (`supply * bps / 10_000`
  floored to nothing at low basis points, leaving `cast > 0` as the only
  requirement), with a floor of 500 bps. The YES threshold is capped at 7,500:
  unanimity is deadlock, and `set_round` has no caller but a ratified proposal. It used to be read at execute, so
  the divisor moved while people voted: minting during a proposal bought quorum
  (each new vault is a whole vote and only a fraction of a vote's worth of bar),
  and minting after voting closed but before execution could push a proposal that
  had already won back below the line.
- **A passed proposal is not a bearer instrument.** It expires 7 days after
  voting ends, and it may not install a round that has already closed. Without
  both, a ratified proposal could be banked and fired months later to overwrite a
  live round and reinstate a stale price.
- `update_gov_config` — admin. `min_voting_secs` and `threshold_bps` **ratchet UP
  only**, so an admin key that turns hostile cannot lower the bar on a vote it
  wants. `quorum_bps` may move BOTH ways, deliberately: the divisor is supply ever
  MINTED, which never falls, while burns remove voters — a quorum that could only
  ratchet up is a governance system with an expiry date.
- ⚠️ **`min_voting_secs` is a config value with a 60-second floor, and the floor
  exists ONLY so the execute path is testable. THE DEPLOYED VALUE MUST BE DAYS.**
  The Bank alarm asserts it.

## Cross-program wiring: one source of truth

MINT and BURN read the **SEAL config** as canonical, and GOV reads MINT's. Every
such read is pinned by the Anchor discriminator AND a `version` byte declared as
the account's first field, so a future upgrade that reorders fields fails loudly
instead of misreading whatever bytes now sit at that offset.

BURN keeping its own copy of `reserve_mints` was a real defect: a mint added to
SEAL and not to BURN was never derived, never required and never checked, and a
vault holding it burned cleanly. There is now no second copy to diverge.

## Token-2022 is refused at CONFIG time, not at redemption

The ATA program gives every Token-2022 ATA an `ImmutableOwner` extension, so its
length is **170, never 165** (measured). Both reserve checks demand exactly 165 —
deliberately, because a Token-2022 confidential balance reads zero in the base
`amount` field. Together those make a T22 reserve mint a permanent seal: close
fails forever, and open is illegal without a terminal close. The reserve list is
additive by design, so that landmine was one ordinary config change away. Reserve
mints are therefore checked for classic SPL when they ENTER the config, which
turns a customer funds-loss into an admin error message.

All three intended reserve mints (cbBTC, $GARY, $GIRAFFISH) are classic SPL,
verified on mainnet.

## PROVEN IMPOSSIBILITIES — do not file these as bugs

1. **A bare Core `BurnV1` by the owner cannot be prevented** while the vault stays
   freely transferable. `PermanentFreezeDelegate` blocks transfer but not burn;
   `FreezeDelegate` blocks both and kills resale. There is no burn-only lock.
2. **Token accounts owned by a PDA cannot be enumerated on-chain.** The reserve
   mints are covered deterministically; anything else rests on **whatever the
   control table in "THE SHIP GATE" says actually runs** — which today is
   `bank/cosign.mjs` pre-signature plus two post-hoc detectors. ⚠️ This sentence
   used to end "and, explicitly, NOT the Bank co-signature, because nothing in
   this repository signs a redemption", which contradicted the control table two
   sections above it, in the same document. Round 15. **The same is true of nested Core
   assets** — an undeclared inner vault is DESTROYED by a burn exactly as an
   undeclared token account is (measured 9.5/9.9; under v5 every redemption ends
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
(the MINT program's `["revenue"]` PDA). Every mint price lands here, the
collection's `Royalties` plugin names it as the sole creator at 100%, and any
future income source the project adds points here too. Nobody holds its key.

| step | where | who |
|---|---|---|
| 1. `sweep_sol_for_swap` | **on-chain**, bounded by a SOL fee reserve, destination PINNED in config | permissionless |
| 2. swap SOL → cbBTC (Jupiter) | **OFF-CHAIN — the one trusted hop** | the swap operator key |
| 3. return the cbBTC to the revenue address | off-chain | the swap operator key |
| 4. `split_revenue` | **on-chain, enforced** | permissionless |

`split_revenue` floors the **Bank's** share and sends the **remainder** to the
distributor, so the rounding goes to the holders and the two transfers still sum
to the balance exactly. (It was the other way round until round 6, under a
comment claiming the opposite: the Bank collected every remainder, and at a
balance of 1 it collected all of it. Dust, and a rule stated backwards.) It works
for any token, so a future income source in something else needs no new code.

**The sweep is bounded IN THE PROGRAM.** `sweep_sol_for_swap` is permissionless,
so the 50 SOL constant that used to live in `bank/revenue.mjs` bound nobody:
anyone could push the whole balance above the reserve to the operator key in one
transaction, and the claim that a compromised key "costs one cycle rather than
the treasury" was false. `max_sweep_lamports` and `sweep_cooldown_secs` are both
in config and both enforced — both, because a cap without a rate limit is a step
size, and the suite proves exactly that by landing three sweeps in one
transaction with the cooldown at zero and being refused the identical transaction
once it is set.

| wallet | share | address |
|---|---|---|
| **the community pool** (v6 stage 3): MINT's config PDA's own cbBTC account; paid out on chain by `distribute` + `claim` into each activated vault | **85%** | derived at `initialize` (no key exists) |
| ~~distributor wallet~~ (v5; DELETED in v6 stage 3) | ~~85%~~ | ~~`4epGVaxS4rYH9q8tvEjuzxCtm9gSWQvmEp9By3uUvYge`~~ |
| CBOBTC Squads | **15%** | `bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1` |
| swap operator (transient only) | — | `3QwQnwkrRE2qwxLBsQCMKLfSaQtAHZkx9ugvuyWpxCfe` |

**Steps 2 and 3 cannot be made trustless without a DEX CPI**, so instead of
pretending otherwise they are made small and counted: every sweep and every
return is written to `bank/revenue-ledger.json`, `revenue.mjs --audit`
reconciles them, and the Bank alarm raises a CRITICAL on any sweep older than an
hour with no matching return, on a return of ZERO, and on a return well below
its quote.

**A compromised operator key is RATE-LIMITED by the program rather than bounded to
one sweep, and the difference matters.** It was written down here for a round
while the only "cap" was a constant in `bank/revenue.mjs`, a file no attacker is
obliged to run — so the on-chain `max_sweep_lamports` + `sweep_cooldown_secs`
pair is a real improvement on that. But this paragraph then said the loss was
"one capped, cooled-down sweep", and a round-19 auditor was right that a cap plus
a cooldown is a RATE, not a total.

The honest bound: **each sweep is capped, and the exposure is that cap times the
number of cooldown windows that elapse before the theft is detected and the key
is rotated**, limited also by what the revenue PDA holds above `sol_reserve_lamports`.
The program's own floor `MIN_SWEEP_COOLDOWN_SECS` is **one second**, which only
stops several sweeps sharing one transaction; what makes the cooldown a real rate
limit is the deployed value, and `bank/alarm.mjs` raises `sweep_cooldown_too_short`
at **CRITICAL** every pass when it is below the operational minimum. Detection is
the other half: the alarm reports a sweep with no matching cbBTC return, so the
window is the alarm's cadence plus a human. **Read the bound as cap x windows,
never as "one sweep".**

## Sale controls

- `set_round(opens_at, closes_at, price, cap)` — governance. Scheduled windows,
  a real cap, and the price. `price = 0` is legal (the charter round is free).
- `set_paused` — **admin, immediate, no vote.** A round is a governance decision
  and takes a vote, but stopping the sale when something is wrong cannot wait for
  one. Pausing does not touch the round, so unpausing resumes where it was.
  **Redemption and burn are deliberately unaffected**: a member can always get
  their Bitcoin out of a vault they hold, whatever the sale is doing.
- `set_collection_royalties(basis_points, add)` — admin **and** governance.

## v6 stage 3: THE COMMUNITY POOL, ON CHAIN

Gary, 2026-10-03: *"the % that goes back to the community should live in the
program"* and *"ONLY activated vaults get their share (so they have the ATA
records open and sending is CHEAP)"*.

| step | instruction | who |
|---|---|---|
| the 85% lands in the pool | `split_revenue` (cbBTC only) | anyone |
| a vault joins the schedule | `activate`: level drawn, live, its own cbBTC ATA holds >= 21,000 sats | anyone |
| the pool is shared out | `distribute`: weighted accumulator, Level I..V = 2/3/4/5/6; cadence gate on chain | anyone |
| a vault is paid | `claim` (batched, 14 per legacy tx measured): INTO the vault's recorded cbBTC ATA, never creating one; a frozen ATA is deferred, still owed | anyone |
| a vault is redeemed | `claim` before the sweep, then BURN calls `retire_redeemed` by CPI (refuses while a sat is owed) | the owner |
| a vault is bare-burned | `retire_burned` returns its unclaimed share to the pool | anyone |

Activation is PERMANENT for a vault's life because a sealed vault's balance can
only rise until it is burned. The pool never holds less than it owes
(`ceil(owed_scaled / 1e12)`, suite P.32); the odd sat that does not divide stays
in the pool, owed (P.13). ⚠️ A redemption of a vault holding all THREE reserve
assets must create the owner's destination accounts in a PRIOR transaction
(9.14b/9.14d measured); with them already open, claim + open + sweep + burn fits
(9.14c, 1,169 bytes).

The off-chain `bank/distribute.mjs` payment path below is SUPERSEDED by this and
is rebuilt or retired in stage 4.

## Distribution: THE SCHEDULE OF VAULTS

**Locked by Gary, 2026-08-22.** Five levels, I smallest to V largest. A level is
assigned AT MINT by fate, is permanent, and is raised one step at a time by
burning $CBOB. It never decreases.

| level | odds at activation | weight |
|---|---|---|
| I | 45% | 2 |
| II | 25% | 3 |
| III | 15% | 4 |
| IV | 10% | 5 |
| V | 5% | 6 |

```
vault_share = drop_85 * vault_weight / sum(weights of all ACTIVATED vaults)
```

An unactivated vault has weight 0. The **census** (count per level) and the
**denominator** (total weight) are published at every settlement, which is what
makes a share checkable by the holder instead of taken on trust.

**A Level V vault receives exactly three times a Level One. Not sixteen.**

Every figure on the published card is reproduced from the weights in
`bank/distribute.mjs --selftest` rather than trusted — the 240-vault census
(108/60/36/24/12, denominator **732**), the 2,100-vault census
(945/525/315/210/105, denominator **6,405**), all ten per-$1,000 figures, and the
five shares, which sum to exactly 100.0%. A weight changed by one turns those
assertions red before the card can go out wrong.

### The dust carries; it is never split

Integer satoshis do not divide evenly, and at 2,100 vaults the remainder can be
up to **2,099** sats a settlement — one satoshi short of one per paid vault.
⚠️ **This read 6,404 until round 19**, which is `denominator - 1`: a real upper
bound, and about three times the truth. Round 18 corrected the same figure in
`bank/distribute.mjs` and left this copy standing — one of two identical sites,
this project's signature defect, with the surviving wrong one on the document a
holder reads. The tight bound is `dust < activated count`, because integer
division leaves one fractional part per PAID vault and each is under a satoshi;
it is ATTAINED at `available = denominator - 1`, where every level's floor lands
exactly one short of its weight. Asserted against the real census in
`bank/distribute.mjs --selftest`, so the number here cannot drift from the
arithmetic again. **Ruling: the leftover stays in the pool and goes
out in the next drop.** The alternative (largest-remainder) makes 100% land in
the same settlement at the price of two vaults *at the same level* differing by a
sat, and "your level determines your share" is the whole product. "Nothing
retained" means the Bank keeps no cut — the dust is still the holders'.

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

It is refused, and nothing is burned, when the pool holds nothing undistributed or
no vault is activated. **The monthly run needs nobody** (Gary: *"the monthly path
should run programmatically without any human interaction and require NO $GARY
burn"*): `mint_vault`, `claim_charter_vault`, `activate`, `claim` and the
redemption (`retire_redeemed`, reached from `burn_vault`) each carry the pool and
perform a due distribution in-line, never refusing their host for being early or
empty, exactly once per period (it stamps `last_distribute_at`). In a redemption
it runs after the vault is retired, so the leaving vault is not credited.

`claim` only delivers what was already distributed; undistributed revenue is
claimable by nobody, so a redeemer who leaves before the next distribution takes
only what was distributed and the rest stays for the vaults that remain (P.22e).

The stage-3 emission minimum, the 31-day ceiling and the 1-sat-per-weight gate are
DELETED, with the `emission_min` config field. The dust rule above is unchanged:
accounting is in 1e12-scaled units and the remainder carries.

### The level is ON-CHAIN, assigned at mint, and provable

**SUPERSEDED 2026-08-23/24.** This section used to record Gary's earlier ruling
that the register could stay off-chain (*"we can keep this offchain if we want as
we will gamify it with $CBOB to alter emissions"*), and it listed the costs of
that honestly: with the same party assigning the level and certifying the
assignment, *"assigned by fate, cannot be applied for or appealed"* was our word
rather than a proof. Fifteen of twenty-two auditors across rounds 18 and 19 then
reported the same consequence independently — anyone could fund a vault to 21,000
sats before its `levels.json` entry existed and halt every payout until a human
edited a file.

Gary ruled: **assign at mint, at random, respecting the quantity allowed, with no
way to game it, and mint it to the NFT.** `bank/levels.json` no longer exists.

| what | where | strength |
|---|---|---|
| the minter cannot choose their level | `level` is a reserved attribute key; the PROGRAM appends it | **prevented on-chain** |
| no level exceeds its census | `level_caps` / `level_minted` refuse at the ceiling | **prevented on-chain** |
| the Bank cannot deal off-deck | Merkle proof against a pre-committed `deck_root`, bound to `minted_total` | **prevented on-chain** |
| the deck was not chosen after the fact | `seed = sha256(bank_salt ‖ blockhash(slot X))`, `sha256(bank_salt)` published first, salt revealed at close | **publicly verifiable** |

The index a proof is checked against is `minted_total`, which the program owns.
That is what makes it ungrindable: a minter submits the transaction and chooses
the asset keypair, so anything derived from data they control could be simulated
and retried until it landed on V — but they cannot choose which mint number they
are.

`distribute.mjs` reads the level from the **asset account** (`fetchAsset`, Core's
own deserialiser over the bytes Core wrote), not from DAS, because this number
decides how much every holder is paid and DAS fail-open has already produced
three separate defects here.

⚠️ **THE HALT REMAINS, AND IT IS NO LONGER CUSTOMER-REACHABLE.** A vault whose
level cannot be read still stops the whole distribution rather than being
excluded — excluding one holder silently overpays every other holder
*permanently*, while halting is recoverable. What changed is what the halt now
means: not "an operator has not typed this in yet" but "the chain and this code
disagree about a vault", which is worth stopping for.

⚠️ **THE PACKET BOUND IS A REAL PRODUCT CONSTRAINT.** The deck proof shares the
1,232-byte transaction with the provenance attributes, so `MAX_ATTRS = 8` is a
Borsh bound and the number that actually binds is smaller and depends on DECK
DEPTH. Measured at depth 7: seven caller attributes fit, the eighth does not
serialize. A deeper deck leaves less room for provenance. **Decide the deck size
before minting opens** — the root is committed once and cannot be renegotiated.

## Known limits, stated rather than papered over

> **This list holds costs that were CHOSEN.** Unrepaired audit findings live in
> **ACCEPTED LIMITS** below, which is a different list with a different rule for
> what belongs in it. If you are about to add a limit here, ask whether it is a
> consequence of a decision (here) or a defect nobody is going to fix (there).

- **The SOL → cbBTC swap is off-chain and trusted.** See the revenue table
  above. The SPLIT is enforced on-chain; the SWAP is not, and cannot be here.
- **A REDEEMED VAULT DESTROYS ITS OWN PROVENANCE.** Round 5 made `mark_opened`
  preserve charter attributes because the vault was stated to be the only
  surviving record of charter membership once the Proof-of-Burn token and the
  Notice are destroyed. v5 destroys the vault, so it destroys that record with
  it. What survives is the mint transaction and DAS's burnt entry. Asserted at
  6.5/6.6 so a charter member never discovers it instead. **This is the price of
  the rule and it is Gary's to pay; it is not a defect.**
- **A vote is atomically rentable.** Transfer the vault to a broker, cast, and
  transfer it back, all in one transaction: the owner signs once, standing holds
  for the slot that matters, and the `VoteRecord` is written. Binding the vote to
  the ASSET stops a vault voting twice; it does not stop the vote being lent.
  Fixing it needs a snapshot of holders, and a snapshot needs somebody to compute
  it and everybody else to trust them — which this design rejects on purpose. So
  it is a stated limit, not a claim of a binding stronger than the property.
- **A vault minted during a proposal may vote on it.** Standing is read live and
  a Core asset carries no creation slot, so there is nothing to check against.
  What is closed is the quorum game: the DIVISOR is snapshotted at proposal
  creation, so minting can no longer move the bar in either direction.
  **THE BANK CO-SIGNATURE IS THE CONTROL, AND IT IS NOW A WRITTEN DUTY:** the
  Bank must refuse to co-sign a mint while a proposal's voting window is open,
  and must refuse a charter-priced mint that is not backed by a burned Proof of
  Burn. Neither is enforceable on-chain — `attributes` is caller-supplied and a
  price-0 round is legal by design — so both are duties, and the alarm now
  watches `mint.minted_total` so supply growth is never silent.
- **`minted_total` never decrements**, so it is issuance, not live supply. Burned
  vaults keep counting toward quorum while their votes are gone. That is why
  `quorum_bps` is the one governance parameter that may be lowered.
- **The 7-day proposal execution deadline is NOT exercised by the test suite**,
  for the obvious reason. Its sibling — that a proposal may not install a round
  that has already closed — is tested end to end.
- **`--reconcile` cannot be integration-tested locally**: it needs DAS and a real
  cluster, and the test validator has neither. Its JUDGEMENT is a pure detector
  proven both ways; only the I/O is untested, and that is why it is said here.
- **1 lamport griefs a burn — but only until the next redemption.** Anyone can
  send lamports to the derivable asset-signer PDA, and `burn_vault` refuses on a
  non-zero balance. Under v5 the owner sweeps them inside the SAME redemption
  (measured, 9.10/9.11), so it costs the griefer their lamports and costs the
  holder one extra instruction. The check cannot be dropped (see proven
  impossibility 4).
- **Adding a reserve mint costs redemption capacity permanently, and v5 makes
  that a HARD CEILING — now measured and capped.** A redemption is one transaction
  — open, every sweep, the burn — so transaction size bounds the product, and the
  reserve list is additive-only. Until round 13 `MAX_RESERVE_MINTS` was **8**,
  which is a Borsh bound standing where a packet bound was needed: one ordinary
  admin `update_config` could add mints until no redemption fit and seal every
  vault that already existed, irreversibly.

  Measured (9.14) by building the real **worst case** — every reserve swept AND
  closed, both ATA derivations declared, and the PDA's lamports swept too, because
  a stranger can put lamports in any vault for free (9.10) and the burn refuses
  until the same transaction takes them out (9.11):

  | reserve mints | 1 | 2 | 3 | 4 |
  |---|---|---|---|---|
  | legacy bytes | 831 | 975 | **1119** | cannot be serialized |

  144 bytes per mint against 1232. `MAX_RESERVE_MINTS` is **3** in SEAL and BURN —
  exactly the three reserve assets, with 113 bytes to spare — and 9.15/9.16 assert
  both constants against the measurement, so raising one without re-measuring
  turns the suite red. **A fourth reserve mint is no longer a config change**: it
  needs a versioned transaction, an address lookup table, and a client that builds
  one, none of which exist. 9.13a pins the measurement's own foundation — that an
  unsigned serialization already reserves the 64 bytes per signature, without
  which every number here would overstate by 192.

  ⚠️ **AND ONLY TWO FIT IF THE REDEEMER MUST CREATE THEIR DESTINATION ATAs**
  (measured, 9.14b: 1 -> 991, 2 -> 1215, 3 -> over). Every other number here
  assumes the redeemer already owns an ATA for each reserve mint. A first-time
  redeemer does not. **Creating them is not required to be atomic with the burn —
  unlike the sweep — so it MUST be a prior transaction.** That is an operational
  requirement on any redemption client, it was a silent assumption until round 14,
  and a client that naively folds the creation into the redemption fails at three
  reserve mints.

  **COMPUTE UNITS ARE NOW MEASURED, AND THE FEAR WAS THE WRONG WAY ROUND.** This
  paragraph read "compute units are NOT measured anywhere — a second, unexamined
  ceiling that may sit below the byte ceiling" for nineteen rounds, and it was
  still saying it in the tree AFTER the commit whose title is "limit 17 clears".
  Measured on the artifact (`meta.computeUnitsConsumed` off landed transactions,
  not a simulation): a plain mint is 58,956 CU / 890 bytes, and the widest pad the
  packet allows is 18 instructions at 73,657 CU, leaving 1.33M of the 1.4M cap. At
  816.7 CU per padded instruction, exhausting compute would need roughly 1,700
  padding instructions, which is about 32,000 bytes of transaction. **The byte wall
  binds more than twenty-five times before the compute wall**, so a transaction
  that fits cannot run out of compute on this path.
  Assertions 10.1-10.4 pin it, including a deliberately generous 400,000 CU
  regression ceiling. See ACCEPTED LIMITS, item 12/17, DISCHARGED.
- **A PDA owner cannot redeem**, so `mint_vault` requires the owner to sign. This
  makes bulk issuance to absent members impossible by design.
- **Program upgrade authority must move to a multisig** before mainnet, or "no key
  can unseal a vault" is false by one indirection. **Except the Bank key, which
  must stay a plain keypair — see the 2-of-2 section.**
- **METAPLEX CORE IS THE FIFTH PROGRAM AND WE DO NOT CONTROL IT.** Every seal,
  thaw, sweep and burn is a hand-built CPI into Core, whose upgrade authority is
  live and is not ours. `scripts/run-tests.sh` refuses to certify against a Core
  that is not byte-identical to the pinned mainnet dump; until round 13 that gate
  had **no production counterpart**, and a Core upgrade changing `UpdatePluginV1`,
  `ExecuteV1` or `BurnV1` semantics would have reached every vault with no signal.
  The alarm now watches `prog.core.upgrade_authority` and `prog.core.hash`. It
  detects; it cannot prevent.
- **A burned asset address cannot be reused** (measured, 9.12/9.13): Core leaves a
  1-byte tombstone at `Key::Uninitialized`, still Core-owned and still holding
  2,495,280 lamports, and `CreateV2` over it is refused by the System program with
  "account already in use". "Never exists again" is true of the address as well as
  the vault — but it rests on Core behaviour we do not control, which is one more
  reason `prog.core.hash` is now watched.
- **`INIT_AUTHORITY` in all four programs is the CBOBTC Squads**
  `bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1` (off-curve, signs by CPI). A
  Squads vault cannot sign locally, so `--features localnet` swaps in a test key.
  That is the ONE way the tested binary differs from the shipped one, and it
  cannot be checked by inspection: the compiler folds the 32-byte compare into
  instruction immediates and no contiguous run of even 4 key bytes survives in
  the `.so` (measured). `scripts/build-mainnet.sh` therefore deploys BOTH builds
  to a validator and asks each whether it trusts the test key — mainnet must
  REJECT, localnet must ACCEPT — then prints the sha256 to deploy.

## ACCEPTED LIMITS — the audit carry list, closed

**Read this before filing a finding.** Nineteen audit rounds produced these.
Every one was measured, every one is real, and the ones under ACCEPTED are not
going to be fixed. A limit written down before a round is not a finding when
that round re-reports it; a limit left unwritten resets the freeze counter every
time a fresh reader notices it, which is the treadmill `audits/FREEZE.md` exists
to leave.

**This section and "Known limits, stated rather than papered over" above are
different lists and the difference is not stylistic.** That one holds properties
of the DESIGN — consequences of decisions taken deliberately, most of them
on-chain and permanent. This one holds unrepaired AUDIT FINDINGS. A defect that
is accepted lands here; a cost that was chosen lands there. Numbering follows
`audits/FREEZE.md` so the two documents can be read side by side, which is why
there are gaps: a discharged item keeps its number rather than letting the list
renumber underneath a reader.

**Three states, and an item is in exactly one of them.** ACCEPTED means will not
fix. OPEN AND BLOCKING means it must be done before anything mints and must not
be quietly demoted to accepted — limit 17 sat there for five rounds and was
discharged by measurement, not by argument. DISCHARGED means measured closed,
with the measurement named, so a later reader can neither re-report it nor
mistake the list for complete.

---

### ACCEPTED — will not fix

#### `bank/cosign.mjs` — the Bank's judgement of a redemption

**1a. The program ALLOWLIST and the FEE-PAYER check are off-chain. The
Bank-pubkey confinement is NOT — it is on chain, in both programs.**

⚠️ **THIS ITEM UNDER-CLAIMED WHEN IT WAS FROZEN, AND ROUND 20 CAUGHT IT.** It
said the confinement was off-chain too. It is not: SEAL's `open_for_redemption`
refuses `BankKeyOutsidePair` and MINT's `mint_vault` refuses
`BankKeyOutsideMint`, both since round 17. `bank/cosign.mjs` states this
correctly and its off-chain arm is belt-and-braces — it refuses before a
signature exists rather than spending a transaction to find out.

The failure was mine and it is worth recording precisely: Phase 1 built the
mechanism that stops a limits list drifting (the audit prompt READS this section
rather than carrying a copy) and then seeded this section from `audits/FREEZE.md`,
whose copy of 1a predates round 17, **without measuring it against the code.** The
file that contradicts it was in the same bundle the auditors read. A fix is a
place a defect can live.

What is genuinely off-chain: the PROGRAM ALLOWLIST and the FEE PAYER, both in
`judgeRedemptionTx`. The fee payer appears in no instruction's account list, so no
on-chain walk can see it at all.
*Costs:* a redemption signed with a tool other than `scripts/bank-sign.sh` gets
neither of those two checks. The confinement it gets regardless, because the
programs enforce it. *Who:* the Bank, whose SOL is what a fee-payer abuse spends.
*Why not fixed:* a Solana signature is produced by whoever holds the private key.
A cron calling the co-signer does not stop the key holder signing with six lines
of `web3.js`. Only key CUSTODY closes it, and custody is a property of the machine
the key ends up on, not of this repository — which is Phase 0's finding and is the
reason the phase's own title was wrong.

**1b. The Bank's POLICY is procedure, not enforcement.** The Bank's signature is
mandatory and on-chain — the 2-of-2 is real — but *which* transactions it agrees
to sign is a tool a human runs. *Costs:* every rule the co-signer enforces is
only as good as the operator using it. *Who:* holders relying on the Bank's
stated refusals. *Why not fixed:* same as 1a.

**2. A coverage refusal has no override.** The customer's answer to a dust
airdrop into their vault is to declare it and let the burn destroy it; the
`undeclarable` refusal blocks that route too. *Costs:* a vault can be made
unredeemable-until-an-operator-intervenes by a stranger for the price of an
airdrop. *Who:* the holder. *Why not fixed:* the override is the exact hole the
refusal exists to close, and "a human can sign by hand" is rhetorical — there is
no flag for it, deliberately. **BUYER-FACING.**

**3. The Bank may still be named `payer` inside the approved pair itself.** Arm 1
exempts the two approved instructions entirely. *Costs:* Bank SOL, through
priority fees, on a transaction that is otherwise legitimate. *Who:* the Bank.
*Why not fixed:* the exemption is what makes the pair signable at all; narrowing
it means judging the pair's own account lists, which is new surface in the
judgement file immediately before a freeze.

**4. The allowlist permits a bare Core `BurnV1` of a SECOND vault beside a real
redemption.** *Costs:* an owner can destroy a second vault of their own in the
same transaction the Bank signs. `correlateBurns` is per-asset so the second
burn still raises a CRITICAL. *Who:* the owner, to their own property — but the
Bank's name is on the transaction. *Why not fixed:* refusing it means the
co-signer deciding which of an owner's own burns are legitimate, which it is not
positioned to know. **BUYER-FACING.**

**5. The judge never looks at where the swept money goes.** *Costs:* a redemption
that sweeps to an address the holder did not intend is signed like any other.
*Who:* the holder. *Why not fixed:* the destination is the holder's to choose and
the Bank has no way to know which address a holder meant.

#### `bank/lock.mjs` — the mutual exclusion under the money crons

**6. An aborted `flock` run is indistinguishable from one that never fired, in
the log.** *Costs:* diagnosis time after an incident. *Who:* the operator.
*Why not fixed:* it is a logging shortfall, not a correctness one, and every
change to this file in rounds 12, 14, 15 and 16 introduced a defect.

**7. A wedged-but-alive holder is a permanent silent skip under `flock -n`.** A
process that holds the lock and never finishes stops every later run.
*Costs:* payouts stop until a human notices. *Who:* holders. *Why not fixed:*
the alternative — a timeout that steals the lock — is how a double-payment
happens, and `detectDistribution` raises `distribution_unfinished` at HIGH, so
the stall is not silent to the alarm even though it is silent in the lock's own
log.

#### `bank/alarm.mjs` / `bank/detectors.mjs` — continuous detection

**8. Cross-pass correlation lag.** If the signature walk reaches the burn in a
LATER pass than the DAS diff, the CRITICAL has already gone out and nothing
retracts it. *Costs:* a false CRITICAL that a human must close by hand.
*Who:* the operator. *Why not fixed:* retraction means the alarm editing its own
history, and a pipeline that can un-say a CRITICAL is worse than one that cries
wolf. ⚠️ This item FELL OFF round 16's carry list while still unfixed; the leak
is recorded in the freeze log as one.

**9. Nothing detects a FOREIGN Core asset nested in a vault CONTINUOUSLY.**
⚠️ **NARROWED BY MEASUREMENT, ROUND 20 PREP — this limit was written wider than
it is true.** `bank/cosign.mjs` DOES see it: `scanPda` calls DAS
`getAssetsByOwner` on the vault's asset-signer PDA, pushes every non-burnt asset
it returns regardless of collection, refuses on a DAS error rather than reading
it as "owns nothing", and refuses a full page rather than judging a truncated
list. So a foreign nested asset fails the redemption CLOSED. What is missing is
advance warning: `detectNestedVaults` walks our own collection and cannot see
it, so nobody is told until a redemption is attempted.
*Costs:* the holder discovers the problem at the moment they try to redeem,
rather than when it happens. *Who:* the holder. *Why not fixed:* continuous
detection needs a per-vault DAS owner search across every vault every pass,
which is a cost increase in the alarm for a case the co-signer already fails
closed on.

#### `bank/revenue.mjs`

**10. No fresh per-cycle swap operator wallet — the one trusted hop.** The
SOL→cbBTC swap is off-chain and the operator wallet is long-lived. *Costs:* the
swap operator can take the SOL. *Who:* holders, of that cycle's revenue.
*Why not fixed:* the split is enforced on-chain and the swap cannot be; a fresh
wallet per cycle changes the blast radius, not the trust. Recorded in "Known
limits" as a design consequence too, because it is both.

#### `bank/distribute.mjs`

**11. Distribution reconciles against a ledger the payer wrote.** *Costs:* a
corrupted or edited ledger is not caught by the reconcile. *Who:* holders.
*Why not fixed:* the only independent source is the chain, and a per-day
chain-side reconstruction of ~2,100 transfers is a second money job with its own
failure modes.

**20. A poisoned ATA silently removes one holder while a whole-payout halt
pages.** (Round 19, carried B.) The `poisoned` branch persists to
`unreadableAtas` and prints a warning; the refusal branch calls NOTIFY. The
paging rule is inverted with respect to targetability: the cheap, targeted attack
is the quiet one. *Costs:* one holder is not paid that day and nobody is woken.
*Who:* that holder. *Why not fixed:* `detectDistribution` raises
`distribution_vault_unreadable` at HIGH within 30 minutes, so the holder is not
lost silently; adding a direct page to a per-vault condition is how an alarm
becomes one that gets scrolled past.

#### MINT

**13. The Attributes plugin is delegated to a SEAL PDA that writes nothing, and
the `redemption` attribute stamp is dead.** `mark_opened` does not exist in v5 —
unbreaking is burning — so no instruction anywhere writes attributes after
`CreateV2`. The plugin's authority is still the SEAL PDA and `ATTR_REDEMPTION`
is still reserved from callers.
⚠️ **THIS IS BIGGER THAN IT WAS WHEN IT WAS WRITTEN, AND THE LEVELS WORK IS WHY.**
The list called this "judged unreachable by two auditors" while `attributes` held
provenance only. It now holds `level`, which decides how much every holder is
paid every day. So the honest statement is: **the level is immutable in practice
because no shipped instruction can rewrite it, and immutable in principle only as
far as the SEAL program's upgrade authority is trustworthy.** Both refusals are
asserted on chain at 11.13/11.14 and the surviving value at 11.15.
*Costs:* whoever controls the SEAL program's upgrade authority could, by shipping
a new instruction, rewrite any vault's level. *Who:* every holder.
*Why not fixed:* it folds into the standing requirement that program upgrade
authority moves to the Squads multisig before mainnet — see "Known limits". The
dead stamp itself is left because removing a reserved key from a shipped program
is a `programs/` change with no benefit. **BUYER-FACING.**

**16. The Bank-as-fee-payer gap exists on the MINT path too.** `mint_vault` has
the on-chain confinement, but the fee payer appears in no instruction's account
list and there is no `judgeMintTx` — `judgeRedemptionTx` is the only judge. A
mint with `feePayer = bank` drains Bank SOL through priority fees without
tripping anything. *Costs:* Bank SOL. *Who:* the Bank. *Why not fixed:* on-chain
cannot close it — a fee payer is a property of the transaction envelope, not of
any instruction — and only custody policy can, which Phase 0 established does not
live in this repository.

**21. The MINT confinement forecloses ever putting the Bank key in a multisig.**
(Round 19, carried D.) SPEC already forbids it for the redemption pairing;
the confinement now forecloses it on the mint path too, by a different mechanism.
*Costs:* the Bank key can never become a multisig without a `programs/` change.
*Who:* the Bank's own key-management options. *Why not fixed:* it is a deliberate
design consequence of confining the key, and the confinement is worth more than
the option it removes.

#### GOV

**15. A vault minted during an open proposal may vote on it.** Standing is read
live and a Core asset carries no creation slot. *Costs:* the Bank could mint into
an open vote. *Who:* every other voter. *Why not fixed:* nothing on chain can
check it; the quorum DIVISOR is snapshotted at proposal creation so minting
cannot move the bar, and the Bank's refusal to co-sign a mint while a voting
window is open is a WRITTEN DUTY, not an enforcement. **BUYER-FACING.**

#### `scripts/`

**18. The unsigned transaction is visible in `ps`.** `scripts/bank-sign.sh` ends
`exec /usr/bin/env node bank/cosign.mjs --tx "$TX"`. *Costs:* a local user can
see a transaction awaiting signature. *Who:* nobody, in practice — it is not a
key and an unsigned transaction is not a secret. *Why not fixed:* closing it
means teaching `cosign.mjs` to read stdin, which is new surface in the judgement
file. The false CLAIM that it was already closed was fixed in round 18; the
mechanism is accepted.

**24. THE DECK IS FAIR; THE QUEUE IS NOT. The Bank co-signs every mint, so it
chooses WHO reaches which index.** (Round 21, six reports.)

The commitment closes the question it was built for: after `commit_seed` and
`commit_deck` the SEQUENCE of levels is fixed by entropy neither side controls,
published on chain, and checkable by anyone. What it does not touch is the
mapping from that sequence to PEOPLE. `deck_index` is `minted_total`, so index 0
goes to whoever mints first — and `mint_vault` takes `bank: Signer`, so the Bank
decides whose mint lands and when.

**A Bank that reads the published deck can therefore hand Level V to chosen
parties without breaking a single on-chain rule**, and every proof still verifies.
*Costs:* the fairness a holder is buying is "the levels were dealt honestly", not
"you had an equal chance of a good one". *Who:* every holder who is not a friend of
the Bank. *Why not fixed:* removing it needs the Bank out of the mint path, and the
Bank's signature IS the 2-of-2 that makes the vault a vault — the same signature
that stops anyone minting into the collection at all. Blind-assigning indices does
not help either, because the Bank still chooses whose transaction it signs.

⚠️ **This one is NOT the author's to accept alone, and it is written here as
OPEN TO GARY rather than as settled.** It is the same class of decision as the
unlevelled-vault halt: it changes who gets what, so it is a product question. The
honest options are (a) accept and DISCLOSE it — the deal is provably fair, the
queue is the Bank's; (b) drop the Bank signature from `mint_vault` and lose the
mint-side 2-of-2; or (c) commit the recipient list before the deck, so neither
side can be matched to the other after the fact. **BUYER-FACING under any of them.**

---

> **v6 (Gary, 2026-10-03) took option (b) for item 24.** There is no Bank, so
> nobody holds the queue, and stage 2 deleted the deck itself. What replaced it,
> and what that leaves, is items 25 and 26.

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
ruled out. *The control:* capture is permissionless and rides on `mint_vault`,
`claim_charter_vault`, `activate` and `claim` (up to 4 queued vaults each), the
crank captures within seconds, and **every reschedule logs
`CBOB_REVEAL_RESCHEDULED`** and counts on the record (`reschedules`), so the alarm
pages on the only event that makes this limit reachable. **BUYER-FACING.**

**26. THE LEADER OF THE LAST ENTROPY SLOT CAN STILL GRIND ITS OWN BLOCK.** The draw
hashes three slot hashes from three different leader rotations (A at or after the
reveal slot, B and C each two 4-slot groups later; alignment measured on mainnet).
That removes every other leader's influence, but C's leader produces its block
KNOWING hA and hB and may vary its contents (or skip, handing C to the next
leader). *Costs:* a validator that is C's leader can bias ONE vault's draw within
one slot's time. *Who:* the census, as in 25. *Why not fixed:* the last
contributor to any public-hash scheme can always do this; only a VRF (a program we
do not control) answers it. One validator was measured holding two adjacent
rotations, so "three different leaders" is likely, not guaranteed. **BUYER-FACING.**

**27. A claim between a BARE burn and its retirement pays into a dead account.** A
vault its owner bare-burns through Core keeps its weight until anyone calls
`retire_burned`; a `claim` in between pays that vault's own share into its cbBTC
account behind the burned asset, where nothing can ever sign for it. *Costs:* that
vault's own share since the last claim. *Who:* only the owner who burned it — no
other holder's share moves. *Why not fixed:* refusing it needs the asset account in
every claimed pair (a third account per vault, a third smaller batch). The crank
retires a bare burn on sight; `retire_burned` returns whatever was not yet claimed.

**28. Coinbase can freeze cbBTC accounts, including the POOL.** A frozen VAULT
account is skipped by `claim`, logged (`CBOB_CLAIM_DEFERRED_FROZEN`) and stays owed
in full (P.18). A frozen POOL account stops every claim until it is thawed.
*Who:* every holder. *Why not fixed:* nothing on Solana can prevent an issuer's
freeze; it is the trust cbBTC itself carries.

**29. Only cbBTC splits.** The pool pays vaults in cbBTC, so `split_revenue` now
refuses any other token; anything else sent to the revenue address stays there.
v5 could split any token to a distributor wallet able to swap it.

**30. ~~The 85/15 ratio is still a VOTE.~~ DISCHARGED by stage 3b:** `split_bps`,
both destinations and `max_supply` are written once by `initialize`; `update_wiring`
no longer exists (suite 0.4i, P.0e, P.0f). Kept for the record: `split_bps` is a governance wiring field,
so holders can vote their own share up or down (whole percent). The DESTINATION of
the 85% is not votable (WiringArgs has no field for it, P.0e). Flagged for Gary:
if "1.5% of the 10%" is meant to be permanent, `split_bps` should be fixed at
`initialize`.

**31. ~~The 31-day branch of the cadence is reasoned, not exercised.~~ SUPERSEDED
by stage 3b:** the cadence is deleted; the free path's period is an `initialize`
value (150 s in the suite), so it IS exercised now (PG.8, PG.9, IN.*). Kept: A distribution
is allowed after 31 days whatever its size (but never under 1 sat per weight unit);
a local validator cannot move its clock a month, so the suite proves the threshold
branch in both directions (P.14-P.16) and not this one.

#### v6 stage 3b — what a vote can reach, the rate limit, and the trigger

**32. The redemption rate limit queues honest holders too.** At most
`ceil(2.1% x live)` (floor 1) redemptions per window, whoever signs: in a rush,
self-custody holders wait in the same line as everyone else, and someone holding
vaults can spend a window's budget by redeeming their OWN vaults (each burned, so
blocking one window costs about 2.1% of live supply in vaults). The window is an
`initialize` value; ⚠️ **mainnet MUST be 3600**. The refill is continuous (RL.3),
proven at 10 s; the 3600 s value is the same arithmetic, not separately exercised.

**33. A replacement swap operator lands after seven days, and that branch is
reasoned.** `arm_swap_operator` (vote) then `apply_swap_operator` (anyone, after
`SWAP_OPERATOR_NOTICE_SECS`). The suite proves the arm, that it does not take over,
that an early apply is refused (6.20g), and that the guardian's sweep stop works
during the notice (6.20h); a local validator cannot move its clock seven days, so
the successful apply is not exercised.

**34. Ordering is per KIND, and says nothing across kinds.** A later executed
round, guardian change or operator arm supersedes an earlier one of the same kind
(7.26). Different kinds execute in whatever order executors choose (RT1.2); a stale
restart is refused by stop time (`StopIsNewer`, 3b.S1) and `tighten_sweep` is
monotone, so neither needs ordering.

**35. The 10% turnout rule only binds when quorum x threshold is under 10%.** With
the suite's quorum 5% and threshold 60% it binds (D.1). The deployed quorum and
threshold are `initialize` values Gary has not set; at quorum 30% the turnout rule
is never the binding constraint.

**36. The in-line monthly run is skipped by a host that is early or the pool
empty, and a month with NO protocol traffic distributes nothing until someone
calls `distribute` or the next host lands.** "Programmatic" means any ordinary
instruction does it; it does not mean a clock fires it.

**37. Every host instruction now carries the pool (one more account).** Measured
costs are in the suite (9.14*, P.33). The redemption carries it through BURN
into `retire_redeemed`.

### OPEN AND BLOCKING — not accepted, must be done before anything mints

These are the ones nobody may write "accepted" against. Limit 17 lived here for
five rounds and left by being measured, which is the only exit.

> v6 stage 3 moved payment ON CHAIN (`distribute` + batched `claim`), so the job this item names is now a crank, not `distribute.mjs`; the item stands for that crank until it has run against a live chain.

**22. NOTHING HAS EVER RUN A DISTRIBUTION AGAINST A LIVE CHAIN.** `distribute.mjs`
now reads each vault's level with `fetchAsset` over what will be ~2,100 vaults.
Cost, rate limits, paging behaviour and failure modes are untested end to end.
Every gate around this job is proven; the job's own I/O at production scale is
not. **This must be exercised before it pays anyone.**

> v6 stage 2 deleted the deck; this item is superseded and kept as history.

**23. THE DECK SIZE MUST BE DECIDED BEFORE MINTING OPENS.** The deck root is
committed ONCE and the deck proof shares the 1,232-byte transaction with the
provenance attributes, so the caller attribute budget falls as deck depth rises.
Choosing the deck after minting opens is not possible, and choosing it without
measuring the budget it leaves is round 13's `MAX_RESERVE_MINTS` defect in a new
place.

⚠️ **AND THE MEASUREMENT THIS ITEM CITED HAD NOT BEEN MADE.** It said "measured at
depth 7, seven caller attributes fit and the eighth does not serialize". The
eighth is refused by the PROGRAM — `attributes.len() < MAX_ATTRS` with
`MAX_ATTRS = 8` — not by the packet, and assertion 11.11 could not have told the
difference: its loop ran `n = 0..7`, so it could never report more than 7, and its
assertion was `7 < 8`, true by construction and incapable of failing. A gate that
has only ever said OK is untested; that one could only ever say OK. Same class as
the compute-unit claim discharged one item above, found one day later.

⚠️ **AND THE FIRST REPAIR REPRODUCED THE DEFECT.** Raising the probe's ceiling
from 7 to 12 returned **12 at depth 7, 12 at depth 11 and 12 at depth 13** —
three different geometries giving one identical number, which is a loop ceiling
wearing a measurement's clothes. The ceiling is 64 now and the arms ASSERT that
the packet actually bound and that a deeper deck buys FEWER attributes, so "the
loop ran out" can never again be reported as "this many fit".

**MEASURED, at last, and it reverses this item's own conclusion:**

| deck depth | vaults | caller attributes the PACKET holds |
|---|---|---|
| 7 | ~90 | **29** |
| **11** | **~2,100 (production)** | **18** |
| 13 | ~8,192 | 13 |

The program allows **7** (`attributes.len() < MAX_ATTRS`, `MAX_ATTRS = 8`). So at
the real census the packet holds 18 and the program permits 7: **the PROGRAM is
the binding constraint, not the packet, and deck size does not squeeze provenance
at any size this product will ever use.** A round-20 auditor filed a CRITICAL
saying not even ZERO attributes fit at depth 11; it is refuted by measurement.

This item stays OPEN AND BLOCKING anyway, and the reason is unchanged: the root
commits ONCE. What has changed is that the decision is now informed by three
measured points instead of by a number nobody had taken.

---

### DISCHARGED — measured closed, kept so the list cannot read as complete

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
`mint_vault` refuses `DuplicateAttribute`. It was bounded and harmless while
attributes were provenance only; the level made it load-bearing, because a map a
reader takes a money decision from may not have two answers. Assertion 11.4.

**19 — the unlevelled-vault halt as a customer-triggerable payout DoS.**
**CLOSED BY CONSTRUCTION**, and it was the single most-reported finding in this
project's history: fifteen of twenty-two auditors across rounds 18 and 19 called
it a public DoS, because anyone could fund a vault to 21,000 sats before its
`levels.json` entry existed and stop every payout until a human edited JSON.
`levels.json` is deleted. The level is written onto the asset by `mint_vault`,
proven against a pre-committed deck and capped on chain, so **there is no window
in which a vault is activated but unlevelled** and no operator types anything.
The REFUSAL deliberately remains — excluding one holder silently overpays every
other holder permanently, while halting is recoverable — but it can no longer be
reached by an ordinary customer action. It now means the chain and this code
disagree about a vault, which is worth stopping for.
⚠️ **And the honest statement of what remains is NARROWER AND STRONGER than the
one this list carried:** `allocateWeighted` refuses the entire distribution when
any activated vault has no readable level, so the Bank **cannot quietly pay
everyone else while dropping a holder.** It can mis-assign a level at mint; it
cannot omit a holder without halting everyone. The halt IS the control that makes
the register honest.

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
| `bank/crank.mjs` | layer one of the three-layer fallback: reschedule, capture, reveal (every minute); retire bare burns, activate at 21,000 sats, the free monthly distribution, deliver claims in batches of 14 (hourly). Permissionless instructions only; its key pays fees and is refused above 0.25 SOL | only where the program already sends it; installed dry-run |
| `bank/alarm.mjs` + `bank/detectors.mjs` | every 30 minutes: approvals, PDA token accounts, burns, balance falls, nested vaults, config and program drift, an overdue distribution, the pool (frozen / short), the 2.1% bucket, the brakes (pull and release, URGENT), reschedules and frozen claims (attributed by the invoke stack, URGENT), a program still upgradeable past `CBOB_LOCK_DEADLINE` | no |
| `bank/accrual.mjs` | the program's payout arithmetic mirrored in BigInt, for the crank and the alarm | no |
| `bank/revenue.mjs` | the one trusted hop: royalty SOL -> cbBTC -> split. Mint prices arrive as cbBTC and need no swap | yes, opt-in `--live` |
| `bank/redemption-poster.mjs` | drafts the public post for every redemption. **No sender** — needs Gary's go-ahead and a website surface | no |

**A read that fails is an alarm, never a pass**, and every v5 rule that enforced
that survives: a missing state file is not day one, a cursor the cluster cannot
resolve is a CRITICAL, an undelivered finding keeps every baseline, the
dead-man's switch watches the watcher, and a dry run consumes nothing.

## Where this stands, honestly

**The stopping condition was NOT reached, and it is not close.** The bar was two
consecutive rounds in which every finding is already-known, already-fixed, or
disproved by a test actually run. Rounds 6, 7, 8, 9 and 10 each produced live
defects — round 10 among them found a swap-operator rotation that took effect on
one signature under a comment arguing it could not move money, when the operator
address is precisely where the swept SOL goes.

What HAS changed across rounds 6 to 10 is where the findings come from. Forty
auditor-passes have produced no surviving finding in the vault mechanics — the
seal, the 2-of-2, the burn emptiness proof, the cross-program config pinning and
the hand-built Core CPIs. Every accepted finding in rounds 9 and 10 was in the
WATCHER or in the previous round's own repair. They are
now almost entirely in the WATCHER and in the previous round's repairs, not in
the vault mechanics: the seal, the 2-of-2, the burn emptiness proof and the
cross-program config pinning have gone four rounds without a finding that
survived. The remaining risk is concentrated in three places, and they are named
rather than implied:

1. **The off-chain pipeline**, where every defect of rounds 7 to 9 was found. It
   carries what Core structurally cannot do, so it cannot be deleted — but it is
   the youngest code here and it has never run against a live deployment.
2. **The one trusted hop.** The SOL to cbBTC swap cannot be made trustless
   without a DEX CPI. It is bounded on-chain, ledgered, and now cross-checked
   against the chain in both directions — and the Jupiter transaction is still
   signed after only a shallow inspection, so **the swap operator must hold
   nothing but the cycle's own funds.** That is an operational instruction, not
   a code guarantee, and it is stated as one. **The operator wallet must hold
   nothing but the cycle's own funds.**
3. **The governance concentration is a business fact, not a bug.** At 190 charter
   vaults and the 500 bps quorum floor, quorum is ten votes and the largest
   holder has around forty. That is the concentration stated up front ("one
   holder has ~21%, the top 3 wallets ~48%"), and what a hostile majority can
   reach is still bounded by MINT: a real cap, a bounded window, and the lifetime
   `max_supply`. It is written here so nobody discovers it as a surprise.
4. **Two Bank duties that are not on-chain rules**: refuse to co-sign a mint
   while a proposal's voting window is open, and refuse a charter-priced mint
   that is not backed by a burned Proof of Burn. Neither is enforceable in a
   program — `attributes` is caller-supplied and a price-0 round is legal by
   design — so both are written duties, and the alarm watches `minted_total` and
   `proposal_count` so neither is silent.

## THE SHIP GATE

> **RULING, Gary 2026-08-22: there will be NO human audit firm. This system is
> audited by AI or not at all.**

Every earlier version of this document leaned on a professional firm reviewing a
frozen version. That backstop is gone, so the AI process now carries the whole
weight and its three structural weaknesses have to be answered rather than
deferred. Named, with what answers each:

| what an AI round structurally cannot do | what answers it here |
|---|---|
| **It reasons; it never executes.** ~1/3 of "CRITICAL" findings across nineteen rounds were WRONG on measurement. | The 576 assertions, real cloned Core suite runs against **real mainnet Core cloned onto a validator**, minting real vaults and moving real tokens. It is what has disproven every wrong claim. |
| **It sees only the bundle.** Rounds 11 and 12 both produced their worst findings in files no auditor had seen, and five files had escaped **thirteen** rounds. Round 19 then asked auditors about three files it had not put in either bundle, which produced two confident wrong findings. | `scripts/audit-coverage.sh` diffs every audit prompt ever sent against the file tree and fails if anything has never been read, and the runner refuses to name a file it did not deliver. |
| **Every round audits code the last round could not see, so rounds never converge.** | The FREEZE below. Without it the stopping condition is unreachable by construction, which is why it has been met zero times in nineteen rounds. |

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

Nineteen rounds, nineteen with a real finding. The gate has been met **zero**
times.

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
./scripts/run-tests.sh          # 576 assertions, real cloned Core, real SPL tokens
                                # (+ 439 detector, 29 allocation, 20 poster,
                                #  14 Proof-of-Burn and 24 live-mainnet
                                #  assertions, run by the same script, each behind an
                                #  assertion FLOOR that must EQUAL its count: an exit
                                #  code cannot tell "all passed" from "stopped early
                                #  and passed what it reached", and a floor that only
                                #  bounds below accumulates slack)
                                # THESE NUMBERS MOVE WITH THE FLOORS IN
                                #  scripts/run-tests.sh AND bank/selftest.mjs, and
                                #  bank/selftest.mjs checks EVERY occurrence here.
./scripts/build-mainnet.sh      # mainnet artifacts + proof of which key shipped,
                                # for ALL FOUR programs, with the git commit recorded
                                # and a dirty tree refused
node bank/accrual.mjs --selftest          # 29 allocation assertions: the program's payout arithmetic
node bank/redemption-poster.mjs --selftest # the public post's copy rules, both ways
node bank/crank.mjs                       # plan one crank pass against mainnet (dry run)
node bank/revenue.mjs --audit         # SOL swept vs cbBTC returned
./scripts/validate-core-gate.sh # proves the runner's Core check fires both ways
node bank/selftest.mjs          # proves every alarm detector fires both ways
node bank/alarm.mjs --reconcile # STATE, not history: what each vault PDA owns
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
