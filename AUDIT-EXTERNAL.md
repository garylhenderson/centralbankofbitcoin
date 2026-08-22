# Independent audit — 5 auditors, 4 model families (2026-08-21)

## VERDICT: DO NOT MINT. Two defects permanently destroy customer Bitcoin.

The Claude opus auditor did not stop at reading — it **REPRODUCED the exploits on
the local validator against real cloned Core, using an SPL token** rather than bare
lamports. Findings C1, C2(nested), C4(collection) and the hollow-vault path are
demonstrated, not argued. Probes: `_probe-vault-audit-token{,2}.ts`,
`_probe-vault-audit-f3.ts`, `_probe-vault-audit-coll.ts` in /opt/gary-club/scripts.

### The root cause of the author's blind spot, in one sentence
> *Both existing test suites only ever put bare lamports in a vault. The product
> holds cbBTC, an SPL token. Every safety property was certified against the one
> asset class the vault will never primarily hold.*


Auditors: `x-ai/grok-4.6`, `google/gemini-3.1-pro-preview`, `openai/gpt-5`,
`moonshotai/kimi-k2.7-code`, plus an independent Claude opus agent. Each was given
lib.rs, SPEC.md and the author's own AUDIT.md, and told to DISPROVE the latter.

## C1 — CRITICAL. `lamports == 0` does not mean "empty". It burns customer BTC.

Found independently by Grok, Gemini and Kimi ("this is the main bug").

```rust
let lamports = ctx.accounts.asset_signer.lamports();
if lamports == 0 { burn_vault(...) }
```

**cbBTC lives in a Token/Token-2022 account OWNED BY the vault PDA — not in the
PDA's lamports.** The ATA's rent sits in the ATA, so a vault PDA can hold 0 lamports
while holding 21,000 sats. `close_redemption` also requires no prior `open`, so it
is a standalone burn.

Exploit, one signature: vault PDA has 0 SOL, its ATA holds 10 cbBTC. Owner signs
`close_redemption`. `nested_live == 0`, `lamports == 0` -> `BurnV1`. The ATA still
holds 10 cbBTC and nothing can ever sign for the PDA again. **Gone.**

Token accounts owned by a PDA **cannot be enumerated on-chain**, so an auto-burn
gated on emptiness can never be made safe this way.

> **The author's own test suite exercised this and recorded it as correct.** Test
> 5.2 created a vault with `mkVault(0)` — zero lamports — and asserted the close
> "burns fine". It did, because that vault was genuinely empty. Same code path,
> same assertion, opposite meaning once real value is involved.

**REPRODUCED:** `open+close (no sweep): ACCEPTED / vault BURNED / cbBTC still in the
orphaned ATA: 100000000 / recovery via Core Execute: IMPOSSIBLE (0x1)`. Also works
as a BARE STANDALONE `close_redemption` — one instruction, one owner signature.

**Fix: `close_redemption` must never burn.** Always re-seal. Burning is a separate,
deliberate, owner-signed act taken only after an off-chain inventory proves the
vault empty — or gated on an on-chain deposit registry this program maintains.

## C2 — HIGH. The invariant is not actually enforced (Grok, GPT-5)

`open` -> owner sweeps everything to any destination -> leave 1 lamport -> `close`
re-seals. The vault still exists, still reads as sealed, and is empty. "Contents can
only leave by destroying the vault" is FALSE as implemented, and the spec's
on-chain marker for a partial drain does not exist. A buyer cannot tell.

## C3 — HIGH. Token delegates drain a SEALED vault (GPT-5, unique)

During a legitimate open, instead of sweeping, the owner can have the PDA `approve`
an SPL delegate. Close then re-seals. The delegate can drain the tokens LATER, while
the vault is sealed and looks full. This defeats the invariant completely and is the
cleanest resale-fraud path. **No marker fixes this** — the drain happens after.
Redemption must forbid/revoke delegates, or the vault must be considered untrusted
once opened.

## C4 — HIGH. Permissionless deposits can BRICK a vault (Kimi, unique)

Anyone can send token accounts or nested vaults to a vault PDA. Only the
single-transaction open+close path exists — `begin/finish` from SPEC.md was never
built. Bloat a victim's vault past transaction capacity (measured: ~7 fungible
assets, ~14 nested vaults) and it becomes **permanently unredeemable**. Costs an
attacker dust; costs the owner everything. Denial of funds, not theft, but on real
BTC that is the same outcome.

## C5 — MEDIUM/product-fatal. SPEC and code disagree about the seal PDA

SPEC.md says `seal = ["seal", vault_asset]`; lib.rs uses one global `["seal"]`.
**Permanent plugins are create-only.** Mint following the spec and no vault can ever
be thawed — unrecoverable, at mint time, for the whole collection. One of the two
documents must be deleted before anything mints.

## C6 — HIGH (REPRODUCED). `collection = None` hardcoded — collection vaults are DEAD

CBOB vaults will live in a collection. Core requires the collection account on
`UpdatePluginV1`/`BurnV1` for a collection asset, so every redemption fails
**Reproduced: `open+close on a COLLECTION vault: REJECTED, Core error 0x19`.**
If the first real mint uses a collection, redemption is dead on arrival for EVERY
vault and the only recovery is a program upgrade — the very key this design exists
to eliminate. Pass the collection account when the asset has one.

## C7 — MEDIUM. `close_redemption` does not check `vault_asset.owner == MPL_CORE_ID`

`open` checks it; `close` does not, and `read_core_owner` only checks
`data[0] == 1`. No exploit found today — the Core CPI rejects a non-asset — but it
is one refactor away from mattering. Add the check.

## C9 — HIGH (new, found only by the Claude auditor). No provenance binding

The seal PDA is `["seal"]` — global and publicly derivable — and nothing checks a
collection or issuer. **Anyone can mint a Core asset naming our seal PDA as its
PermanentFreezeExecute authority**, then have this program open/burn it, emitting
authentic `RedemptionOpened` / `VaultBrokenOpen` events from the official program id.
An attacker mints 10,000 fake vaults, burns them, and any Bank indexer or
proof-of-reserves surface keyed off those events reports redemptions that never
happened against Bitcoin that never existed.

**Fix:** require the vault to belong to the CBOB collection, verified against a
hardcoded collection pubkey.

## C10 — MEDIUM. The guard binds only positional account 0

The scan checks program id, discriminator and `accounts[0] == asset` — not the
close's `owner`. "MUST stay account 0" is enforced by a COMMENT. No exploit found,
but the sharper point from the audit: the guard is **correct but irrelevant** — it
faithfully guarantees "a close follows", while close is burn-OR-reseal with a broken
emptiness test and a reseal branch that defeats the invariant. The security model
rests on a door that is not the one that matters.

## C8 — LOW. Hand-rolled Core wire format is brittle

`06 11 <frozen>` hardcodes PluginType 17. Core is upgradeable; a new Plugin variant
inserted before it retargets the CPI. Use the official builders, or add a CI test
that decodes a live mainnet UpdatePluginV1 and asserts the variant.

## What four independent auditors could NOT break
No path was found to thaw a vault without a genuine top-level `close_redemption`
for the same asset, and none to leave a vault thawed at rest. Non-owner open/drain,
seal/mpl_core/instructions substitution, ALT tricks, discriminator and borrow/panic
paths all held. The introspection guard itself stands.
