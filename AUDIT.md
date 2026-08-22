# CBOB Vaults — internal audit, 2026-08-21

Tested against a LOCAL validator running the **real Metaplex Core program cloned
from mainnet**, so every CPI hits actual Core rather than a mock.

> ⚠️ **This is the builder auditing his own program.** By the standing rule on this
> box — *no single source may both assert and certify* — this document is evidence,
> not a clearance. An independent review is still owed before real value is at risk.

## What was proven (12/12 functional, 8/8 adversarial)

| | |
|---|---|
| unseal with no terminal close | **rejected** (`NoTerminalClose`) |
| paired open + sweep + close, one tx | allowed; PDA drained; vault burned |
| non-owner opens a correctly paired redemption | **rejected** (`NotTheOwner`) |
| close while contents remain | vault **re-sealed**, never left thawed |
| close while a live vault is handed to it | **rejected** (`VaultStillHoldsAVault`) |

Adversarial attempts to satisfy the guard dishonestly, all repelled:

| attack | result |
|---|---|
| pair open(vault1) with close(**vault2**) | rejected — the scan matches account 0 |
| put the close **before** the open | rejected — the scan only looks forward |
| two opens sharing **one** close (free the 2nd vault) | rejected |
| same vault opened twice against one close | allowed, and it re-seals — no leak |

The guard is proven in BOTH directions: the unpaired case fails and the paired case
succeeds. A guard that has only ever said "ok" is untested.

## Findings

### F1 (design gap, MUST FIX before mint) — a partial drain is invisible on-chain
`SPEC.md` says an abandoned redemption should **mark the asset** so a buyer can see
it was partially drained. The code only re-seals and emits `RedemptionAbandoned`.
An event is not state: a hollow vault still looks full to anyone reading the chain.
Either write a Core `Attributes`/`AppData` marker in the re-seal branch, or drop the
claim from the spec. Do not ship the spec's promise unimplemented.

### F2 (known limit, stated not hidden) — the nested-vault guard sees only what it is given
Core assets owned by the vault PDA cannot be enumerated on-chain, so
`close_redemption` can only refuse accounts the client actually passes. Completeness
comes from the off-chain scanner and its chain-truth gPA backstop. A client that
omits a nested vault destroys its owner's own property — bad UX, not a theft vector.

### F3 (accepted) — `close_redemption` standalone burns an empty vault
With no preceding open, close on an empty vault burns it. That is exactly the bare
burn Core already permits to any owner, so it is not a new hole — but it does mean
this program exposes a burn path, and the UI must never call it casually.

### F4 (reasoned, NOT tested) — instruction introspection and CPI
`load_instruction_at_checked` sees only TOP-LEVEL instructions. A `close_redemption`
hidden inside another program's CPI would be invisible, so `open_for_redemption`
would refuse — failing CLOSED, the safe direction. The converse (open invoked via
CPI, close top-level) still requires a genuine top-level close. **This is reasoning,
not a test**; proving it needs a second, hostile program. Worth doing before deploy.

### F5 (operational) — upgrade authority
The program's upgrade authority is currently the deploy keypair. It must move to a
multisig (Squads) before mainnet, or the "no key can unseal a vault" claim is false
by one indirection: whoever can upgrade the program can rewrite the rules.

### F6 (out of scope, needs UI) — two Core-level hazards this program cannot reach
Both are enforced by Core itself, outside any instruction we control:
* a vault transferred to its OWN asset-signer PDA is bricked forever;
* a bare Core `BurnV1` on a funded vault orphans the contents, compounding through
  nesting.
The mint/transfer UI must block the first and never offer the second.

## Not found
No path was found by which the Bank, the program, or a third party can move a
member's contents. `Execute` requires the asset owner's signature, verified on
mainnet, and this program never holds that signature — it can only unseal.
