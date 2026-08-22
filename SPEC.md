# Central Bank of Bitcoin Vaults — v6 spec (written FROM the implementation)

> v1's spec and code disagreed in seven places and auditors flagged the drift as a
> finding in its own right — most dangerously `seal = ["seal", vault_asset]` in the
> spec vs a global `["seal"]` in the code, which would have bricked an entire
> collection at mint. Everything below is read off the source.

**NOTHING HAS MINTED. NOTHING HOLDS REAL VALUE.** Six AI audit rounds have each
found something real. A human audit firm must review a frozen version before any
vault holds Bitcoin; more AI rounds sharpen this, they do not sign it off.

Round 6 was the first to audit ALL FOUR programs together with the off-chain
`bank/` pipeline and the ops scripts. It was also the largest: the alarm's
transaction scanner turned out to be structurally dead after its first pass, the
"50 SOL cap" on the trusted hop existed only in a script that need not be the
caller, and admin alone could appoint itself governance in one instruction. Full
verdict on every finding accepted AND rejected: `audits/round6/VERDICT.md`.

## What a vault is

A Metaplex Core asset in the CBOB collection. Its contents live in Core's
asset-signer PDA `["mpl-core-execute", asset]`, so the wallet is *derived from* the
NFT — transfer the NFT and the balance goes with it. Contents move only via Core
`ExecuteV1`, which requires the **asset owner's signature**. A
`PermanentFreezeExecute` plugin gates whether Execute is permitted at all; its
authority is the SEAL program's `["seal"]` PDA.

Vaults are **born sealed** — measured, not assumed: the plugin decodes
`frozen: true` and an owner's bare Execute with no `open_for_redemption` is
refused on-chain (Core `0x9`) with the contents intact.

## TRUE 2-of-2

| party | holds | cannot do alone |
|---|---|---|
| **the owner** | the asset, and must sign | cannot unseal — the seal is not theirs |
| **the Bank** | `config.bank`, and must co-sign | cannot move contents — Core demands the owner's signature |

Cost of making the Bank a real party rather than a rule: **a lost Bank key halts
redemptions** until `update_config` rotates it. Deliberate.

## The four programs, each with its own upgrade authority

**SEAL** `9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273`
- `initialize(collection, bank, reserve_mints)` — one-time, gated on a compile-time
  `INIT_AUTHORITY`. Every reserve mint account must be passed and be a **classic
  SPL** mint (see "Token-2022 is refused" below).
- `open_for_redemption` — owner + Bank sign. Walks the instructions sysvar and
  REFUSES to thaw unless a `close_redemption` for the **same asset and owner**
  appears later in the same transaction.
- `close_redemption` — **NEVER burns.** Always re-seals, checks every reserve ATA
  for a delegate or close authority that would outlive the seal, and stamps
  `redemption: opened` onto the asset **preserving every other attribute**.
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
- `apply_pending_governance` — permissionless, once the notice period has passed.
  `cancel_pending_governance` — admin, to disarm.
- `sweep_sol_for_swap(amount)` — permissionless; destination PINNED in config;
  **bounded on-chain by `max_sweep_lamports` AND `sweep_cooldown_secs`.**
- `split_revenue(decimals)` — permissionless; the enforced 85/15.
- `set_collection_royalties(bps, add)` — admin **and** governance; bps ≤ 1000.
- `set_paused(bool)` — admin, immediate.

**BURN** `8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8`
- `burn_vault(declared)` — owner + Bank. Requires PDA lamports == 0 and every
  reserve mint's ATA (both token-program derivations) declared and empty. **The
  reserve list is read out of the SEAL config**, never kept locally.

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
- **Quorum is measured against the supply SNAPSHOTTED INTO THE PROPOSAL at
  creation**, read from MINT's `minted_total`. It used to be read at execute, so
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
   assets** — an undeclared inner vault is stranded by a burn exactly as an
   undeclared token account is.
3. **A vault transferred to its own asset-signer PDA is bricked forever**, and
   Core permits the transfer. Blocked in the UI only.
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
hour with no matching return. One cycle is capped at 50 SOL, so a compromised
operator key costs one cycle rather than the treasury.

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
- **A drained vault can still be re-sealed and sold.** The `redemption: opened`
  stamp makes a thaw visible, but it is one bit: a holder who opens, takes
  nothing and closes is stamped too. A buyer should read the reserve ATA balance,
  which anyone can do.
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
  creation, so minting can no longer move the bar in either direction. Minting
  still requires an open round and the Bank's co-signature.
- **`minted_total` never decrements**, so it is issuance, not live supply. Burned
  vaults keep counting toward quorum while their votes are gone. That is why
  `quorum_bps` is the one governance parameter that may be lowered.
- **The 7-day proposal execution deadline is NOT exercised by the test suite**,
  for the obvious reason. Its sibling — that a proposal may not install a round
  that has already closed — is tested end to end.
- **`--reconcile` cannot be integration-tested locally**: it needs DAS and a real
  cluster, and the test validator has neither. Its JUDGEMENT is a pure detector
  proven both ways; only the I/O is untested, and that is why it is said here.
- **1 lamport griefs a burn.** Anyone can send lamports to the derivable
  asset-signer PDA, and `burn_vault` then refuses until the owner sweeps them via
  an open/close — which also stamps the vault. The check cannot be dropped (see
  proven impossibility 4).
- **Adding a reserve mint costs redemption capacity permanently.** Every reserve
  mint adds two declared accounts to every close and burn, against a transaction
  ceiling of roughly 28 assets. Additions are irreversible.
- **A PDA owner cannot redeem**, so `mint_vault` requires the owner to sign. This
  makes bulk issuance to absent members impossible by design.
- **Program upgrade authority must move to a multisig** before mainnet, or "no key
  can unseal a vault" is false by one indirection.
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

**`node bank/alarm.mjs --reconcile`, daily, is the one that carries what the
programs structurally cannot.** BURN's header has always said the non-ATA gap is
covered by an off-chain scanner using `getTokenAccountsByOwner`; until round 6 no
shipped file called it, and no signature scan ever could — creating a token
account owned by a vault PDA needs no signature from the PDA and touches none of
our four programs, so such a transaction appears in no history we read.
Enumeration is impossible ON-CHAIN. It was never impossible from a script.

**A read that fails is an alarm, never a pass.** Round 6 found four places that
broke that rule: a failed balance read became a silent zero (and wrote the vault
down as inactive, so a REAL drain on the next pass was skipped as "already
inactive"); an unfetchable transaction was skipped with its cursor; a null config
read printed "not initialised" and exited 0; and a missing revenue ledger was
swallowed with `catch { /* not a finding */ }`. All four are findings now.

**The watchdog cannot report its own death**, so `cron-install.sh` also installs
a dead-man's switch: plain `find(1)` on the state file's mtime, needing neither
node nor any of this code.

## Running the tests

```bash
./scripts/run-tests.sh          # 144 assertions, real cloned Core, real SPL tokens
                                # (+ the 69 detector and 10 allocation assertions,
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
node scripts/probe-signature-paging.mjs   # the alarm's signature walk, against a
                                # LIVE busy mainnet program — the local validator
                                # has no history to page through
```

The runner builds with `--arch v3`, deactivates SIMD-0500 and SIMD-0161 (both
unscheduled on mainnet) so real Core can load, uses a FRESH ledger every run, and
**refuses to deploy or test unless Core on the validator is byte-identical to the
mainnet dump.** It once certified against the wrong validator; it cannot now.
