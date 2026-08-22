# Central Bank of Bitcoin Vaults — v2 spec (matches lib.rs exactly)

> v1's spec and code disagreed in seven places and auditors flagged it as a finding
> in its own right — most dangerously `seal = ["seal", vault_asset]` in the spec vs
> a global `["seal"]` in the code, which would have bricked an entire collection at
> mint. This document is now written FROM the implementation.

## What a vault is

A Metaplex Core asset in the CBOB collection. Its contents live in Core's
asset-signer PDA `["mpl-core-execute", asset]`, so the wallet is *derived from* the
NFT — transfer the NFT and the balance goes with it. Contents move only via Core
`ExecuteV1`, which requires the **asset owner's signature**.

A `PermanentFreezeExecute` plugin gates whether Execute is permitted at all. Its
authority is this program's PDA `["seal"]` — global, one for all vaults.

## TRUE 2-of-2

Every unsealing requires **both**:

| party | what they hold | what they cannot do alone |
|---|---|---|
| **the owner** | the asset, and must sign | cannot unseal — the seal is not theirs |
| **the Bank** | `config.bank`, and must co-sign | cannot move contents — Core demands the owner's signature |

Verified on mainnet: the Bank is rejected by Core even while holding the seal and
having thawed the vault. Verified on a validator: owner-alone → `NotTheBank`,
non-owner → `NotTheOwner`, both → allowed.

Cost of making the Bank a real party rather than a rule: **a lost Bank key halts
redemptions** until `update_config` rotates it. That is deliberate.

## Instructions

**`initialize(collection, bank, reserve_mints)`** — one-time. Binds the program to
the CBOB collection (provenance) and records the Bank co-signer and the reserve
asset set.

**`open_for_redemption`** — owner + Bank sign. Verifies the asset is a Core
`AssetV1` in our collection and owned by the signer, then walks the instructions
sysvar and REFUSES to thaw unless a `close_redemption` for the **same asset and the
same owner** appears later in the same transaction.

**`close_redemption`** — **NEVER burns.** Always re-seals, and stamps
`redemption: opened` onto the asset's `Attributes` so a vault that has been unsealed
is visibly not pristine.

**`burn_empty_vault(declared)`** — deliberate and separate. Owner + Bank sign.
Requires PDA lamports == 0; requires **every reserve mint's ATA (both token-program
derivations) to be declared and empty**; refuses any declared account that is a live
Core asset (a nested vault).

**`update_config(collection?, bank?)`** — admin only. Rotates the Bank key.

## Why burning is separate

v1 burned whenever `asset_signer.lamports() == 0`. **cbBTC lives in a token account
owned by the PDA, whose rent sits in the token account — the PDA itself reads
zero.** v1 classified a vault holding a whole Bitcoin as empty and destroyed it.
Reproduced on a validator as a two-instruction transaction, and as a
ONE-instruction transaction.

Core exposes no way to enumerate what a PDA owns, so that check can never be made
correct. v2 does not try. Burning is explicit, and the chain enforces what it can:
the reserve set. A vault that outlives its contents is an accounting nuisance; a
burn that outlives its contents is a customer's Bitcoin deleted with their own
signature on it.

## MINT REQUIREMENTS ARE ENFORCED IN CODE, NOT DOCUMENTED

**THE LOCK: the collection's update authority IS the seal PDA.** Core then refuses
any create into that collection this program did not sign — measured, `0x1a`, even
for the Bank itself and even with a `PermanentTransferDelegate` slipped in.
`mint_vault` is the only way to make a vault and it hardcodes the plugin set.

`initialize` is bound to a compile-time `INIT_AUTHORITY` so it cannot be
front-run. **That constant MUST be set to the Squads multisig before the mainnet
build.** A compile-time constant was chosen over an upgrade-authority check
deliberately: the latter could not be tested in both directions on a validator
here, and an untested gate is not a gate.

## KEY SPLIT (Squads)

| role | holder | why |
|---|---|---|
| program upgrade authority | **Squads** | never in a hot path; without it "no key can unseal a vault" is false by one indirection |
| `INIT_AUTHORITY` / `config.admin` | **Squads** | one-time setup and rare rotations |
| `config.bank` | **hot service key** | co-signs EVERY redemption; a multisig would stall members. Powerless alone — it cannot sign as owner |

## PROVEN IMPOSSIBILITIES — do not file these as bugs

These are properties of Metaplex Core and Solana, measured, not choices:

1. **A bare Core `BurnV1` by the owner cannot be prevented while the vault stays
   freely transferable.** Verified matrix: `PermanentFreezeDelegate` blocks
   transfer but NOT burn; `FreezeDelegate` blocks burn AND transfer. There is no
   burn-only lock. Since "sell it as one unit" is a product requirement, the owner
   can always destroy their own vault outside this program. **This program cannot
   be safer than Core's own burn** — `burn_empty_vault` raises the floor, it does
   not and cannot close this.
2. **Token accounts owned by a PDA cannot be enumerated on-chain.** Core and SPL
   expose no such call. The reserve mints' ATAs are therefore enforced
   deterministically (both token-program derivations, declared and empty), and
   anything else — a non-ATA token account, an unknown airdropped mint — rests on
   the Bank co-signature plus the off-chain scanner, which uses
   `getTokenAccountsByOwner` and DOES see non-ATA accounts. Stated rather than
   implied.
3. **A vault transferred to its own asset-signer PDA is bricked forever**, and
   Core permits the transfer. Blocked in the UI, unreachable from this program.

## ⚠️ OPEN DEPLOYMENT BLOCKER

The program builds only under platform-tools **v1.54** (Anchor 0.31 requires
crates needing cargo >= 1.85; v1.43 ships 1.79). v1.54 emits an ELF with machine
`0x107`, and `solana program deploy` on agave 4.2.1 rejects it:
*"Detected sbpf_version required by the executable which are not enabled."*
`--arch v0/v1` does not change it. Loading via `--bpf-program` at genesis works,
which is how the 34 tests run. **Resolve before any deploy** — likely an Anchor
version change or a cluster/toolchain pairing. Untested on mainnet; do not assume
mainnet accepts it.

## MINT REQUIREMENTS — enforced by `mint_vault`, listed for reference

Permanent plugins are **create-only**. Every vault MUST be minted with:

1. `PermanentFreezeExecute { frozen: true, authority: <seal PDA> }`
2. `Attributes { attribute_list: [], authority: <seal PDA> }` — without it,
   `close_redemption` cannot stamp the asset and will fail
3. membership in the CBOB collection recorded in `config.collection`
4. **NO** `PermanentTransferDelegate`, **NO** `PermanentBurnDelegate`, **NO**
   execution delegate — any of these is a second party able to take or destroy a
   member's vault

## Known limits, stated rather than papered over

- **Unknown airdropped tokens cannot be enforced on-chain.** The reserve set is
  covered deterministically; anything else relies on the Bank co-signature and the
  off-chain scanner with its chain-truth `getProgramAccounts` backstop.
- **A drained vault can still be re-sealed and sold.** The `Attributes` stamp is
  what makes that visible; a buyer must check it.
- **Program upgrade authority must move to a multisig** before mainnet, or
  "no key can unseal a vault" is false by one indirection.
- **Two Core-level hazards live outside this program**: a vault transferred to its
  own PDA is bricked forever, and a bare Core `BurnV1` by the owner orphans the
  contents. Both must be blocked in the UI.
