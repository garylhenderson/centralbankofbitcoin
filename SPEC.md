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

### ⚠️ AND NEITHER CAN A VAULT'S OWNER. A DAO CANNOT HOLD A VAULT.

Round 14: the Bank rule is the narrow case. **Any address that cannot sign a
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

### THE CONTROL TABLE — the ONE place that says what actually runs

Every comment elsewhere points HERE rather than restating it, because for six
rounds running this project's most repeated defect has been a comment asserting a
control that does not exist. If you change what runs, change this table.

⚠️ **THE FOURTH COLUMN EXISTS BECAUSE THREE COLUMNS COULD NOT TELL THREE VERY
DIFFERENT THINGS APART.** For eight rounds the table said WHAT each control checks
and WHEN, and a reader took "pre-signature" to mean something happens before a
signature. It has exactly three values and they are not degrees of the same thing:

| | meaning |
|---|---|
| **ON-CHAIN** | a program refuses. Nobody can opt out, including us. |
| **AUTOMATIC** | a cron runs it on a schedule, and reports after the fact. |
| **PROCEDURE** | a human runs a tool. Real, and skippable. |

⚠️ **THE FIRST VERSION OF THIS COLUMN GOT THE CO-SIGNER WRONG IN THE OPPOSITE
DIRECTION TO EVERY PREVIOUS ROUND, AND THAT IS WHY THE ROW WAS SPLIT IN TWO.** It
had one row for `bank/cosign.mjs` reading *"PROCEDURE. Nothing forces a redemption
through it, and nothing can."* Every word of that is true **about the policy** and
it reads as though **the Bank's involvement** were optional. It is not: SEAL and
BURN each take `bank: Signer` and each `require_keys_eq!` it against the Bank in
their own on-chain config, so **no vault can be unsealed or burned without the
Bank's signature, ever.** That is the multi-sig, it is enforced by the programs,
and a buyer reading only this table would have been told the opposite.

Seven rounds of comments claiming controls that do not run trained this project to
look for over-claiming. **Under-claiming a control that DOES run is the same
defect**, it is the one this table shipped, and it is the more expensive direction
here because the thing understated is the core guarantee.

**The column is MECHANICALLY TRUE, not a claim.** `bank/selftest.mjs` parses these
rows: ON-CHAIN rows must name a program whose Rust really does pin the Bank as a
signer, AUTOMATIC rows must name a file `scripts/cron-install.sh` really installs,
PROCEDURE rows must name one it does not. All three are proven in both directions.
Wire the co-signer into a cron and leave the column reading PROCEDURE, and the
build goes red; so does the reverse; so does claiming ON-CHAIN for a program that
does not demand the signature.

| control | what it catches | when | **does anything RUN it?** |
|---|---|---|---|
| **THE BANK MUST SIGN AT ALL** — the 2-of-2 itself | any unsealing or burn attempted **without the Bank**. `programs/cbob-vaults/src/lib.rs` and `programs/cbob-vault-burn/src/lib.rs` each take `bank: Signer` and `require_keys_eq!` it against the Bank in their own config, so a redemption missing the Bank's signature does not fail policy, it fails to execute. The owner must sign too, and cannot be an off-curve program address. See **TRUE 2-of-2** above | every redemption, always | **ON-CHAIN.** Two programs refuse. Nobody can opt out, us included. |
| **THE BANK'S KEY IS CONFINED TO THE INSTRUCTION IT SIGNS FOR** | any transaction that makes the Bank's signature authorise something that is not the thing it agreed to. `programs/cbob-vaults/src/lib.rs` walks every top-level instruction and refuses `BankKeyOutsidePair` if `config.bank` appears outside the open/burn pair; `programs/cbob-vault-mint/src/lib.rs` refuses `BankKeyOutsideMint` outside a `mint_vault`. **MINT was the round-17 CRITICAL** — it had neither this check nor any off-chain judge, and a mint happens at every activation while a redemption happens once, at exit. Does NOT see the FEE PAYER, which appears in no instruction's account list | every mint, every redemption | **ON-CHAIN.** Two programs refuse. |
| **`bank/cosign.mjs`** — what the Bank looks at before it signs | **the transaction touching any program outside the redemption allowlist**, and **the Bank's own pubkey appearing in any instruction other than the approved pair** — those two are what stop the customer spending the Bank's signature on something that is not their redemption. Then: the pair, the asset/owner binding, the Bank named in both, an off-curve owner, a lying declared count, **the Bank as fee payer**, **a durable-nonce transaction** (its signature would never expire), and **every token account or nested Core asset the vault holds that the burn does not declare** — including a Token-2022 account carrying EXTENSIONS, whose balance cannot be read from the base layout and which `burn_vault` refuses as a declared account | **pre-signature** | **PROCEDURE.** An operator runs `./scripts/bank-sign.sh`. The Bank's signature is mandatory (row above); **which transactions it agrees to sign is policy**, and a key holder can apply a different policy with a different tool. |
| `detectNestedVaults` (alarm, EVERY pass) | a CBOB vault owned by any vault's asset-signer PDA, a vault owned by its OWN, and any vault owned by an off-curve address | post-hoc, ≤30 min | **AUTOMATIC.** `bank/alarm.mjs`, cron, installed by `scripts/cron-install.sh`. |
| `detectUndeclaredTokenAccounts` (`--reconcile`) | any token account a vault PDA owns that is not a canonical reserve ATA | post-hoc, daily | **AUTOMATIC.** `bank/alarm.mjs --reconcile`, cron, installed by `scripts/cron-install.sh`. |

⚠️ **ROUND 15 MEASURED THIS TABLE'S FIRST ROW SIGNING A THEFT.** Before the round
the co-signer refused only a second instruction to SEAL or BURN, and a Solana
signature authorises the WHOLE message: `[open_for_redemption,
SystemProgram.transfer(from=BANK, to=attacker), burn_vault]` returned `ok:true`
with an empty reasons array on a real serialized transaction, and `--live` would
have signed it. The customer composes the transaction. The same control had
already been written thirty lines into `bank/revenue.mjs` ("LOOK AT IT BEFORE
SIGNING IT ... is a blank cheque") and was not applied to the newer, more
valuable signer — one of two identical sites, this project's most repeated
defect, for the sixth round running.

⚠️ **THE CO-SIGNER IS A MITIGATION AND NEVER A PROOF, and that must stay written
down.** Its scan reads what the asset-signer PDA owns at a slot BEFORE the
transaction lands. A third party can fund a PDA-owned token account in between —
for free, needing nobody's cooperation — and that holding is then destroyed by a
burn the tool blessed. There is no transaction-level read lock over "everything
this PDA owns" and Core has no enumeration primitive to move the check on-chain,
so **the airdrop race narrows and never closes**. It DOES close the nested-vault
case in practice, because nesting needs the owner's own cooperation.

It is **inspect-only by default**; `--live` signs, and turning it on is a
decision, the same way `revenue.mjs` is installed without it. There is no Bank key
on this box yet.

**AND ITS REFUSAL IS A GRIEFING SURFACE, stated rather than hidden.** Declare
everything plus the 1232-byte ceiling means anyone can make a vault
unredeemable-by-this-tool for the price of a dust airdrop, and an extension-
bearing Token-2022 account cannot be declared at all. The choice is a VISIBLE
block against an INVISIBLE loss — without the refusal the burn silently orphans
whatever is there — and this project takes the visible one. The escape is a human
who has looked, which is the reason the default is inspect-only.

**NOTHING FORCES A REDEMPTION THROUGH THIS TOOL — WHICH IS NOT THE SAME AS SAYING
THE BANK CAN BE SKIPPED, AND AN EARLIER DRAFT OF THIS PARAGRAPH BLURRED THE TWO.**
Be exact about which half is which:

- **The Bank's SIGNATURE is mandatory and on-chain.** SEAL and BURN each demand
  `bank: Signer` matching their own config. No vault opens or burns without it.
  Nobody can route around that, including us.
- **The POLICY the Bank applies before signing is this tool**, and a key holder
  could apply a different policy with a different tool. That half was carried for
  two rounds as an open gap to be closed by wiring; it cannot be closed that way,
  because a Solana signature is produced by whoever holds the private key. A cron
  that calls the co-signer does not stop the key holder signing with `web3.js` in
  six lines. Only key CUSTODY does, and custody is an ops property of the machine
  the key ends up on, not of this repository.

So what a member is buying is a real 2-of-2 that the chain enforces, plus a Bank
that has published, and gated, the policy it applies to its half. What the
repository can do about the second half, and now does, is make the sanctioned path
singular and make a second one a build failure — see the section below.

⚠️ **ONE OF THE TWO WAS MOVED ON-CHAIN, AND THIS PARAGRAPH DENIED IT FOR HOURS.**
It said both checks were policy and that moving them on-chain "is not done" —
written before the move and never re-read after it. Two round-17 auditors caught
it independently, in the ninth round of this exact defect class.

**The bank-pubkey confinement is now ON-CHAIN in BOTH programs that take the
Bank's signature.** SEAL's `open_for_redemption` refuses `BankKeyOutsidePair`;
MINT's `mint_vault` refuses `BankKeyOutsideMint` — MINT was the CRITICAL, because
it had neither the check nor any off-chain judge, and a mint happens at every
activation while a redemption happens once, at exit.

**Still policy, and only policy:** the PROGRAM ALLOWLIST (System must stay
permitted for rent and the SOL sweep, so an allowlist would not have stopped the
theft anyway, and a list baked into a program that a future redemption falls
outside would strand that vault forever) and the FEE PAYER (it appears in no
instruction's account list, so no on-chain walk can see it).

One gap remains in the post-hoc detection, stated rather than implied:
`detectNestedVaults` sees CBOB vaults only, so a **foreign** Core asset nested in
a vault is caught by the co-signer but not by the alarm.

### SIGNING A REDEMPTION — the ONE sanctioned path

```bash
./scripts/bank-sign.sh tx.b64            # inspect only. Reads no key.
./scripts/bank-sign.sh tx.b64 --live     # inspect, then sign if and only if clean.
```

`tx.b64` holds the base64 of the customer's UNSIGNED redemption transaction.
There is no other command, and **producing a Bank signature any other way is out
of policy.** Policy is the correct word and is chosen over "impossible" on
purpose: see the paragraph above.

These are gated in `bank/selftest.mjs`, each proven in both directions, so that a
second signer is a build failure rather than a discovery. (No count in this
sentence on purpose — an enumeration is how one of them gets deleted by someone
tidying up, which is a finding a round-16 auditor made against a comment in
`bank/detectors.mjs`.)

- **ONE READER OF THE BANK KEY,** across `bank/`, `scripts/` and `tests/` — not
   just `bank/`, which is all the round-16 original checked (verified with `git
   log -S`, not remembered). `bank/cosign.mjs`, and nothing else, may reach the
   key. Nothing is excluded from the scan by name, this file included.
- **THE SIGNER SET IS PINNED** — every file anywhere in the repository that can
   turn bytes into a keypair is enumerated with the key it reads
   (`cosign.mjs`→Bank, `revenue.mjs`→swap operator, `distribute.mjs`→distributor).
   A fourth signer, or an existing one reaching for a different key, is red. This
   is the arm that catches a second signer which HARDCODES its own path to the
   Bank key instead of using the documented one — the bypass a round-16 auditor
   named, which the one-reader check alone could not see.
- **THERE IS NO ROUTE TO A SIGNATURE THAT SKIPS THE SCAN** — `cosign.mjs`
   contains exactly one `partialSign`, and it is downstream of the refusal exit.
   `scripts/bank-sign.sh` adds no flag that could get past it and refuses any
   argument it does not recognise rather than forwarding it.
- **ONLY THE WRAPPER MAY INVOKE THE CO-SIGNER**, so "the sanctioned path" is a
   fact about the tree rather than a habit.
- **THE CONTROL TABLE'S FOURTH COLUMN MATCHES CRON**, in both directions.
- **THE WRAPPER READS THE TRANSACTION BEFORE IT CHANGES DIRECTORY.** This one is
   here because it was a real, shipped-for-an-hour defect and no gate could have
   seen it: the first version `cd`-ed to the repo root first, so a relative
   `tx.b64` resolved against the REPOSITORY rather than the operator's shell.
   Measured from `/tmp` against a stale `tx.b64` at the repo root, it fed the
   co-signer the wrong file and said nothing — the Bank asked to judge a
   DIFFERENT transaction than the one named, fail-OPEN. Found by running the
   tool, not by reading it; every other arm above reads the tree as TEXT and is
   structurally blind to what the code does when it runs.

**What this does NOT do, stated so nobody reads the section as more than it is:**
it does not stop the holder of the key signing elsewhere, it does not log the
signatures the Bank produces, and it does not narrow the airdrop race by one slot.
It makes the sanctioned path singular, documented and greppable, and it makes a
second path inside this repository loud. That is the whole claim.

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
| distributor (pays the vaults daily) | **85%** | `4epGVaxS4rYH9q8tvEjuzxCtm9gSWQvmEp9By3uUvYge` |
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

### Cadence: ONE threshold, and the band falls out

Gary: *"we should be able to dynamically change emission frequency. Daily,
Weekly, Monthly (nothing longer or shorter) but volume will determine how frequent
we distribute."*

There is **no stored band**. `bank/distribute.mjs` runs daily (cron `7 9 * * *`)
and pays when the smallest activated holder — a Level I vault — would receive at
least `EMISSION_MIN_PER_VAULT`. Volume does the rest: enough of it clears the
threshold every day and reads as daily, less clears it in about a week, and
anything that never clears it is forced out at `MAX_HOLD_DAYS` (31), so no holder
ever waits longer than a month **while the pool can give every activated vault at
least one satoshi**. ⚠️ Round 19: that qualifier is load-bearing and was missing
here and in `distribute.mjs`. Below one satoshi per vault — a denominator's
worth, 6,405 sats at the 2,100-vault census — `decideEmission` returns "nothing
to distribute" before the ceiling is consulted, and the wait is unbounded. The
ceiling forces out a small pool, not an empty one. Judging on the SMALLEST share rather than an
average makes the threshold a promise to every holder rather than to the average
one. A stored band would be a second copy of a fact volume already determines.

⚠️ **`EMISSION_MIN_PER_VAULT` IS PROVISIONAL AT 21 SATS** — one part in a thousand
of the activation floor, which is a defensible story and not a ratified number.
**Gary must set it before anything runs live.**

### The level register is OFF-CHAIN, and what that costs

Gary: *"we can keep this offchain if we want as we will gamify it with $CBOB to
alter emissions."* So there is no program change, no Core attribute and no
on-chain VRF on the critical path. `bank/levels.json` maps vault to level;
`distribute.mjs` only ever READS it, and a missing or unparseable register is a
hard stop rather than an empty map.

⚠️ **Off-chain moves a cost rather than removing one.** The card says a level is
"assigned by fate, permanent, cannot be applied for or appealed". On-chain that
sentence is enforced; off-chain it is our word, with the same party assigning the
level, storing it and paying against it — one source both asserting and
certifying, which this project refuses everywhere else. The cheap fix is not
on-chain storage, it is a **commitment**: publish a hash of the sealed assignment
before any activation and reveal after, so a holder can check their level was not
moved. **Not built. Until it is, "cannot be appealed" is a promise, not a proof.**

### Still open — DO NOT HARDCODE

Named in the locked schedule and deliberately absent from the code: the
randomness source (VRF vs commit-reveal vs a sealed 240 deck), the $CBOB upgrade
cost ladder (*proposed* 2,016 / 4,032 / 8,064 / 16,128), and whether upgrades open
only after the first FOMC. The settlement cadence was also listed as open and is
now decided, above.

### What the job refuses to do

Refuses to pay twice (one distribution per UTC day, every transfer recorded before
the next begins, so a crash resumes instead of redoing), refuses to pay an
activated vault carrying **no level** — that is a fact about our data, not a
weight of zero, so it stops the whole distribution rather than quietly dropping
one holder — refuses to create a token account for a vault PDA (an activated vault
already has one; a missing one means the vault is not what we think it is, so it
is skipped and reported), and refuses to guess (any failed read stops the run,
because a distribution computed from a partial vault list would silently overpay
everyone visible).

### Language

**weight · share of distributions · clears · census · denominator.**
Never *rate, yield, APY, return, reward, guaranteed*. Era names are flavour only.

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

  ⚠️ **AND ONLY TWO FIT IF THE REDEEMER MUST CREATE THEIR DESTINATION ATAs**
  (measured, 9.14b: 1 -> 991, 2 -> 1215, 3 -> over). Every other number here
  assumes the redeemer already owns an ATA for each reserve mint. A first-time
  redeemer does not. **Creating them is not required to be atomic with the burn —
  unlike the sweep — so it MUST be a prior transaction.** That is an operational
  requirement on any redemption client, it was a silent assumption until round 14,
  and a client that naively folds the creation into the redemption fails at three
  reserve mints.

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
| **It reasons; it never executes.** ~1/3 of "CRITICAL" findings across thirteen rounds were WRONG on measurement. | The 270-assertion suite runs against **real mainnet Core cloned onto a validator**, minting real vaults and moving real tokens. It is what has disproven every wrong claim. |
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
./scripts/run-tests.sh          # 311 assertions, real cloned Core, real SPL tokens
                                # (+ 436 detector, 95 allocation and 19 live-mainnet
                                #  assertions, run by the same script, each behind an
                                #  assertion FLOOR: an exit code cannot tell "all
                                #  passed" from "stopped early and passed what it
                                #  reached")
                                # ⚠️ ROUND 19: THE FLOORS NOW DEMAND EQUALITY, not
                                #  merely "at least". A `-ge` floor accumulates
                                #  slack: the on-chain suite really made 286 while
                                #  this block and MIN_ASSERTIONS both said 284, so
                                #  two assertions could have been deleted for free.
                                #  Found only by RUNNING the suite, which round 18
                                #  could not.
                                # ⚠️ THESE FOUR NUMBERS MOVE WITH THE FLOORS IN
                                #  scripts/run-tests.sh AND bank/selftest.mjs. They
                                #  read 178/93/14 against a real 270/355/17 for
                                #  several rounds — a stale count here is how a
                                #  reader learns the floors are decorative.
./scripts/build-mainnet.sh      # mainnet artifacts + proof of which key shipped,
                                # for ALL FOUR programs, with the git commit recorded
                                # and a dirty tree refused
node bank/distribute.mjs --selftest   # 63 allocation assertions, both directions
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
