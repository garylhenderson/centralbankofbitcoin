# Central Bank of Bitcoin Vaults — v10 spec (written FROM the implementation)

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

## TRUE 2-of-2

| party | holds | cannot do alone |
|---|---|---|
| **the owner** | the asset, and must sign | cannot unseal — the seal is not theirs |
| **the Bank** | `config.bank`, and must co-sign | cannot move contents — Core demands the owner's signature |

Cost of making the Bank a real party rather than a rule: **a lost Bank key halts
redemptions** until `update_config` rotates it. Deliberate.

### ⚠️ THE BANK MUST BE A PLAIN KEYPAIR. DO NOT PUT IT IN THE MULTISIG.

Every other authority in this system is the CBOBTC Squads vault, and moving the
Bank key there is the obvious next hardening step. **It would halt every
redemption.** v5 needs `open_for_redemption` and `burn_vault` as two **top-level**
instructions in one transaction; a Squads execution is ONE top-level instruction
that CPIs its contents, so both halves become inner, the open's forward scan finds
no top-level burn, and it refuses. The same applies to any smart wallet, relayer
or program that signs on the Bank's behalf.

It **cannot** be enforced on chain: `Pubkey::is_on_curve` is host-only and panics
on BPF, so `update_config` cannot refuse a program address even in principle.
`bank/alarm.mjs` checks it off-chain every pass (`detectBankIsNotSignable`,
CRITICAL). Recovery is a rotation, which waits out the seven-day notice — so the
mild version of this mistake is a week without redemptions.

**Admin is the opposite and must NOT be confused with it.** Admin's instructions
are single top-level calls with no introspection, so a Squads vault signs them by
CPI perfectly well. Admin as a PDA is the intended production shape.

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

| control | what it catches | when |
|---|---|---|
| `detectNestedVaults` (alarm, EVERY pass) | a CBOB vault owned by any vault's asset-signer PDA — and a vault owned by its OWN | post-hoc, ≤30 min |
| `detectUndeclaredTokenAccounts` (`--reconcile`) | any token account a vault PDA owns that is not a canonical reserve ATA | post-hoc, daily |
| the Bank's co-signature | anything, in the moment | **NOTHING. See below.** |

⚠️ **THERE IS NO BANK CO-SIGNING TOOL IN THIS REPOSITORY.** Every document here,
and the headers of both programs, lean on "the Bank sees the whole transaction and
must refuse". That is true of a Solana signature and false of this codebase: no
file signs a redemption, so no file scans before signing. Until one is built the
pre-signature refusal is a human procedure, not a control, and the honest
statement of the nesting and airdrop gaps is **detected within thirty minutes,
never prevented**.

Two further gaps in the detection itself, stated rather than implied:
- `detectNestedVaults` sees CBOB vaults only. A **foreign** Core asset nested in a
  vault needs a per-vault DAS owner search and nothing does it.
- Both detectors are post-hoc, so they report a destruction that has already
  happened as readily as one that is pending.

## The four programs, each with its own upgrade authority

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
   mints are covered deterministically; anything else rests on the Bank
   co-signature and the off-chain scanner. **The same is true of nested Core
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
| distributor (pays the vaults daily) | **85%** | `4epGVaxS4rYH9q8tvEjuzxCtm9gSWQvmEp9By3uUvYge` |
| CBOBTC Squads | **15%** | `bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1` |
| swap operator (transient only) | — | `3QwQnwkrRE2qwxLBsQCMKLfSaQtAHZkx9ugvuyWpxCfe` |

**Steps 2 and 3 cannot be made trustless without a DEX CPI**, so instead of
pretending otherwise they are made small and counted: every sweep and every
return is written to `bank/revenue-ledger.json`, `revenue.mjs --audit`
reconciles them, and the Bank alarm raises a CRITICAL on any sweep older than an
hour with no matching return, on a return of ZERO, and on a return well below
its quote.

**A compromised operator key costs one capped, cooled-down sweep rather than the
treasury — and that is true because the PROGRAM says so.** It was written down
here for a round while the only "cap" was a constant in `bank/revenue.mjs`, a
file no attacker is obliged to run.

## Sale controls

- `set_round(opens_at, closes_at, price, cap)` — governance. Scheduled windows,
  a real cap, and the price. `price = 0` is legal (the charter round is free).
- `set_paused` — **admin, immediate, no vote.** A round is a governance decision
  and takes a vote, but stopping the sale when something is wrong cannot wait for
  one. Pausing does not touch the round, so unpausing resumes where it was.
  **Redemption and burn are deliberately unaffected**: a member can always get
  their Bitcoin out of a vault they hold, whatever the sale is doing.
- `set_collection_royalties(basis_points, add)` — admin **and** governance.

## Daily distribution

`bank/distribute.mjs`, cron `7 9 * * *`. Equal per **activated** vault
(>= 21,000 sats of cbBTC), because one vault is one unit and one vote. It refuses
to pay twice (one distribution per UTC day, every transfer recorded before the
next begins, so a crash resumes instead of redoing), refuses to create a token
account for a vault PDA (an activated vault already has one; a missing one means
the vault is not what we think it is, so it is skipped and reported), and refuses
to guess (any failed read stops the run, because a distribution computed from a
partial vault list would silently overpay everyone visible).

## Known limits, stated rather than papered over

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

  **Compute units are NOT measured anywhere.** A second, unexamined ceiling that
  may sit below the byte ceiling.
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

## The Bank alarm pipeline — `bank/`

A real share of the guarantee is off-chain, so it gets a watcher rather than a
paragraph. `bank/alarm.mjs` runs every 30 minutes and alerts by EMAIL (never SMS)
on: any Approve against a vault PDA; any token account created for one (canonical
reserve ATAs INFO, anything else CRITICAL); any burn; any vault that leaves the
collection or turns burnt; **any FALL in a vault's reserve**, not merely one below
the activation line; SOL swept for the swap with no cbBTC back, or a return well
below its quote; a governance rotation armed; and drift on every config value,
**every program's upgrade authority and deployed bytes, and the collection
account**. Every detector is proven in BOTH directions by `bank/selftest.mjs`
(69 assertions).

**Sweeps are read off the CHAIN, not out of our own file.** The revenue ledger is
written by the same process, as the same user, on the same box, as the
swap-operator key it is supposed to be auditing — five of eight round-7 auditors
said so independently. `detectUnledgeredSweeps` runs over the MINT signature scan
the alarm already does and demands a ledger row for every sweep it finds. A sweep
with no row is CRITICAL whoever made it.

**The daily distribution is watched too.** Nothing read `distributions.json` at
all until round 7, so a failed transfer was recorded and skipped in silence, a
day where nobody was paid exited green, and a day that never ran left no trace.

**`node bank/alarm.mjs --reconcile`, daily, is the one that carries what the
programs structurally cannot.** BURN's header has always said the non-ATA gap is
covered by an off-chain scanner using `getTokenAccountsByOwner`; until round 6 no
shipped file called it, and no signature scan ever could — creating a token
account owned by a vault PDA needs no signature from the PDA and touches none of
our four programs, so such a transaction appears in no history we read.
Enumeration is impossible ON-CHAIN. It was never impossible from a script.

**A read that fails is an alarm, never a pass.** Round 6 found four places that
broke that rule, and round 7 found three more: a MISSING state file read as day
one (so `rm state.json` re-baselined the whole watcher and printed "no config
drift"), the deadman cron could not see that because `find` on an absent path
prints nothing, and the scan cursors advanced even when the alert failed to send
— so a CRITICAL approve or burn whose email bounced was scanned past and never
mentioned again. The four from round 6: a failed balance read became a silent zero (and wrote the vault
down as inactive, so a REAL drain on the next pass was skipped as "already
inactive"); an unfetchable transaction was skipped with its cursor; a null config
read printed "not initialised" and exited 0; and a missing revenue ledger was
swallowed with `catch { /* not a finding */ }`. All four are findings now.

**The watchdog cannot report its own death**, so `cron-install.sh` also installs
a dead-man's switch: plain `find(1)` on the state file's mtime, needing neither
node nor any of this code.

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
| **It reasons; it never executes.** ~1/3 of "CRITICAL" findings across thirteen rounds were WRONG on measurement. | The 264-assertion suite runs against **real mainnet Core cloned onto a validator**, minting real vaults and moving real tokens. It is what has disproven every wrong claim. |
| **It sees only the bundle.** Rounds 11 and 12 both produced their worst findings in files no auditor had seen, and five files had escaped **thirteen** rounds. | `scripts/audit-coverage.sh` diffs every audit prompt ever sent against the file tree and fails if anything has never been read. |
| **Every round audits code the last round could not see, so rounds never converge.** | The FREEZE below. Without it the stopping condition is unreachable by construction, which is why it has been met zero times in thirteen rounds. |

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

Thirteen rounds, thirteen with a real finding. The gate has been met **zero**
times.

The pattern that keeps producing findings is nameable now: **a fix is a change,
and a change is a place a defect can live.** Its most common shape here is a fix
applied to one of two identical sites, which has happened in five rounds running.

## Running the tests

```bash
./scripts/run-tests.sh          # 178 assertions, real cloned Core, real SPL tokens
                                # (+ the 93 detector and 14 allocation assertions,
                                #  now run by the same script, and an assertion FLOOR:
                                #  an exit code cannot tell "all passed" from
                                #  "stopped early and passed what it reached")
./scripts/build-mainnet.sh      # mainnet artifacts + proof of which key shipped,
                                # for ALL FOUR programs, with the git commit recorded
                                # and a dirty tree refused
node bank/distribute.mjs --selftest   # 10 allocation assertions, both directions
node bank/revenue.mjs --audit         # SOL swept vs cbBTC returned
./scripts/validate-core-gate.sh # proves the runner's Core check fires both ways
node bank/selftest.mjs          # proves every alarm detector fires both ways
node bank/alarm.mjs --reconcile # STATE, not history: what each vault PDA owns
node scripts/probe-mainnet-facts.mjs      # the two things this rests on that the
                                # local validator CANNOT test: the alarm's
                                # signature walk against a live busy program, and
                                # that cbBTC and both other reserve mints are
                                # classic SPL with no extensions
```

The runner builds with `--arch v3`, deactivates SIMD-0500 and SIMD-0161 (both
unscheduled on mainnet) so real Core can load, uses a FRESH ledger every run, and
**refuses to deploy or test unless Core on the validator is byte-identical to the
mainnet dump.** It once certified against the wrong validator; it cannot now.
