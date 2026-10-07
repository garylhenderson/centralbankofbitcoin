# Review 35: `rescue_nested` + PermanentTransferDelegate (adversarial, read-only)

Scope: `git diff 1281ab4 -- programs/ tests/ bank/ SPEC.md HOLDER-GUIDE.md scripts/run-tests.sh`, plus the
untracked `web/src/lib/plan-vault.mjs` / `ix.mjs` rescue builder, SEAL/BURN/GOV interplay, and Core source
at `.cache/triage26p-core` (commit `e72d63e`). Nothing was run. No files changed except this one.

**Bottom line: no CRITICAL or HIGH.** The rescue authority cannot be exercised by any other path, and the
destination cannot be chosen by the caller. The real problems are in the **live-host branch's premise**
("the host's owner already controls the vault through the host"). That premise is false whenever the host's
Execute is frozen, and it is the exact case the change was built for (a vault sent to a *sealed CBOB vault's*
deposit address). There are also test gaps on two checks whose removal would lose a vault permanently.

---

## CONFIRMED

### M1 (MEDIUM, design): the live-host branch hands a vault to someone who could NOT reach it, and bypasses third-party FreezeExecute locks
`programs/cbob-vault-mint/src/lib.rs:1839-1846` (dest = host's owner whenever the host is a live AssetV1), doc
comment `:1820-1822`, SPEC item 58 ("who already controls the vault through the host").

The justification holds only if the host owner can run Core `ExecuteV1` on the host. Two common shapes break it:

* **(a) The host is a sealed CBOB vault** (every live vault is born `PermanentFreezeExecute` frozen). Its owner
  cannot Execute. Before this change, the only way they could reach the nested vault was to redeem and destroy
  their own vault (open, Execute, burn). After it, **anyone** can move the nested vault to them immediately and
  for free. SPEC calls the dominant cause of nesting "the easy mistake the deposit page invites". *Scenario:*
  Alice means to fund Bob's vault V1 and sends her vault NFT V2 to V1's deposit address. Any stranger, or Bob,
  calls `rescue_nested(V2, host=V1, new_owner=Bob)` and V2 permanently becomes Bob's. If Alice had sent V2 to
  **its own** deposit address instead, the program would route it to the Squads and the Squads would "return it
  to whoever sent it" (`HOLDER-GUIDE.md:172-177`). The same mistake gets opposite outcomes, and the outcome that
  takes value from the sender is the automatic one.
* **(b) A foreign host held under a third-party `FreezeExecute` (owner-managed, plugin 16) or
  `PermanentFreezeExecute` lock.** That lock is how Core escrows "an asset plus what its signer holds": bundles,
  collateral, staking. `PermanentTransferDelegate::validate_transfer` returns `force_approve!()`
  (`core/.../permanent_transfer_delegate.rs`), and the plugin loop returns on the first ForceApproved
  (`core/.../plugins/lifecycle.rs:733`), so no freeze on the *vault* can stop the move. The host's freeze is never
  consulted because the move is a Transfer of the vault, not an Execute on the host. *Scenario:* the seller lists
  "sealed vault H with vault V inside" as a bundle, or pledges it, and then runs the rescue to strip V out before
  the sale or loan settles. Before this change, V inside a sealed or frozen H was provably locked.

**Fix (owner decision):** limit the live-host branch to hosts whose Execute the owner can actually use. The
simplest version: route a host that is a **CBOB vault of `config.collection`** to `bank_treasury` (the
return-to-sender policy, the same as an orphan), and refuse foreign live hosts entirely (`HostUnresolved`).
Their owner can Execute if the host is unfrozen, and if it is frozen, that lock belongs to a third party. If
Gary wants the host-owner route kept, at least require that the host carries no frozen
`FreezeExecute`/`PermanentFreezeExecute` (walk the host's Core registry), and record the policy for (a)
explicitly in SPEC 58 and the holder guide.

### M2 (MEDIUM, griefing): a permissionless rescue can send a vault to a custody program that cannot release it
Same lines, `:1842-1846`. `dest` is whatever is in the host's owner field. If the host is held by a program
(a marketplace escrow, staking custody, or any PDA that only knows how to return the host itself), a stranger can
move the nested vault to that program's PDA. Afterwards the vault's owner is a PDA that is **not** an
asset-signer, so `rescue_nested` refuses it (`NotNested`). The alarm can only report it as `unredeemable_owner`.
Before the change, whoever eventually got the host back could Execute and pull the vault out. After it, the vault
can be stuck for good, and any stranger can trigger that at the cost of a transaction fee. SPEC 58's "who can
misuse it" (a stranger un-nests and it "returns it to that holder") assumes the host's owner is a person.
**Fix:** in the live-host branch, require the host's owner to sign (`payer == dest`, signer), or only allow it
for CBOB hosts (see M1). A Squads or DAO can still sign by CPI.

### L1 (LOW, policy/off-chain): for a burned host, "return to the sender" is often the wrong person
`bank/detectors.mjs` (`vault_rescued_to_squads` detail: "Find the wallet that sent it there"),
`HOLDER-GUIDE.md:176`, SPEC 58. Once V sits inside H, it travels with H. If H was sold or transferred after
the nesting and then redeemed or burned, the person who **controlled** V was H's owner at burn time (named in
BURN's `VaultBurned.owner` / the burn tx), not whoever originally sent V in. The live-host branch already treats
the host owner as rightful, so the two branches apply different principles. **Fix:** for a burned host, the
runbook and alert should name H's last owner from H's burn transaction (plus the original sender, for review),
and keep "sender" only for the self-nested case.

### L2 (LOW): the Squads can vote and propose with vaults it holds; SPEC says it "can only transfer it on"
`SPEC.md:1710-1711`. `cast_vote` and `create_proposal` check only `owner == Signer`
(`programs/cbob-vault-gov/src/lib.rs:418-420, 311-312`), with no top-level requirement, so a Squads vault
transaction (a PDA signing by CPI) can vote with every orphan it is holding "to return by hand". That gives the
Bank's multisig governance weight that comes from other people's property, and it grows with every orphan.
(Payout accrual is fine: it stays inside the vault.) **Fix:** correct the SPEC sentence. Either make GOV refuse a
vault whose owner equals MINT's `bank_treasury` (GOV already reads MINT config by offset; bank_treasury is at
`[157..189]`, `gov/src/lib.rs:137`), or adopt a written operating rule that the Squads never votes with a held
vault.

### L3 (LOW, completeness): true orphans that the rescue refuses forever
* **A self-nested *foreign* host** (`host.owner == PDA(host)`): `RescueNoProgress` (`:1849`). Its advice,
  "rescue the host first", works only when the host is a CBOB vault, because `require_live_vault` refuses a
  foreign one. Nobody can ever sign for that host, so V is orphaned but refused.
* **A host that is a live Core `CollectionV1` (key 5) or `GroupV1` (key 6)**: Core `ExecuteV1` accepts only an
  AssetV1 (`core/processor/execute.rs`: it validates AssetV1 permissions; a collection cannot Execute), so V is
  orphaned, but `:1844` returns `HostUnresolved`. Oddly, a *burned* collection or a *closed* group leaves the same
  1-byte tombstone (`core/utils/account.rs:10-33`, used by burn and close_group), so those **are** rescued to the
  Squads. The live case refuses and the dead case accepts.
* A host owned by a non-Core program (a token account, a config PDA): it can never become a Core asset, so this
  is a permanent refusal. (`is_on_curve` panics on BPF, so a never-created off-curve host cannot be told apart;
  accept.)
**Fix:** treat `dest == owner` (the host sits in its own signer wallet) as an orphan and send it to
`bank_treasury`. Treat a Core-owned `CollectionV1` or `GroupV1` host as an orphan.

### L4 (LOW, off-chain): the detector texts and classes do not match the rescue
`bank/detectors.mjs:1297-1330`.
* `everyVault` includes **burnt** vaults (`bank/alarm.mjs:329, 498`). For a host that is already burned,
  `nested_vault` still says "return it to ${host}'s owner; if ${host} is burned first ... Squads". It should say
  that the host is burned and the rescue goes to the Squads.
* A vault nested in a **foreign** asset's signer PDA falls through to `unredeemable_owner` ("marketplace escrow
  ... or sealed for good"), which does not mention `rescue_nested`, even though the rescue applies to it.
* Every vault the Squads holds (an off-curve owner) will page `unredeemable_owner` **CRITICAL every pass** until
  someone returns it by hand, with text about marketplace escrow. That may be the desired volume, but it should
  carry its own kind and text (e.g. `held_by_bank_treasury`).
* The `nested_vault` text promises a rescue to the host's owner even when that would be `RescueNoProgress`.

### L5 (LOW, docs now inconsistent)
* `SPEC.md:484-493`: "an undeclared inner vault is DESTROYED by a burn" and "A vault transferred to its own
  asset-signer PDA is bricked forever". Both are now false (item 58).
* `HOLDER-GUIDE.md:119-120`: "anything else (token, another NFT, another vault) is destroyed when the vault is
  opened". A nested vault is now orphaned and rescued to the Squads, not destroyed.
* The holder guide's "Who can do what" table has no row for "anyone: rescue a nested vault, to a fixed
  destination". It also omits the Squads' new custody role, alongside "Gary Club cannot ... move a vault in a
  wallet whose key it does not hold".

### L6 (LOW, tests): two load-bearing checks are unpinned, and the suite misses several cases
The tests that exist are non-vacuous. R35.N1/N3/N4/N7 are pinned by `because(...)` to the exact MINT error
(`tests/3prog.test.ts:3812-3813`), and N2/N5/N6 assert the resulting owner. Gaps:
1. **The `d[0] == KEY_ASSET_V1` check (`:1844`) is never exercised.** If it were deleted, a host that is the
   **vault collection** would give `dest = d[1..33]`, the collection's update authority, which is MINT's
   `["mint"]` PDA. The vault would be moved there permanently: that PDA is not an asset-signer, so it is not
   rescuable, and MINT has no instruction that moves it. Add: vault parked at `PDA(COLL)` →
   `HostUnresolved`.
2. **The host-owner check (`:1842`) is never exercised.** Add a host owned by SPL Token or System that holds
   data → `HostUnresolved`.
3. **`RescueNoProgress` is never exercised.** Add: CBOB H self-nested with V in PDA(H), so V →
   `RescueNoProgress`; then H → Squads; then V → Squads (chain termination).
4. **A foreign live host** (non-CBOB Core asset): its destination is its owner. **A foreign burned host** → Squads.
5. **The cycle** (V in PDA(H), H in PDA(V)): V → PDA(V) → Squads, then H → Squads. Worked out by hand below;
   not tested.
6. **`vault` = a foreign-collection asset that names MINT's rescue PDA as its PermanentTransferDelegate**
   (anyone can mint one) → `NotALiveVault`. This pins `require_live_vault`'s collection check. Also a burned
   vault → `NotALiveVault`.
7. **The same-transaction sequence "open V (via host Execute) → rescue V → burn V"** must revert. That is the
   analytic result in I4; test it with a foreign unfrozen host.
8. **R35.N8 (`:1480-1488`) maps every failure to `REJECT`.** Pin Core's error codes the way R34.G4 does
   (0x9 / 0x1a / 0x1b), or an unrelated failure (a wrong account in `common`) would pass.
9. If L2 is fixed in code, add a test that a vault owned by `bank_treasury` cannot vote. If it is not, add one
   that documents that it can.

---

## INFO / verified safe (what I could and could not confirm)

**I1. The rescue PDA cannot be exercised by any other path. CONFIRMED by reading.** `RESCUE_SEED` appears in
exactly one `invoke_signed` (`:1867`). Its program id is the constant `MPL_CORE_ID`, its data is the constant
`[14, 0]` (TransferV1, no compression proof), its asset is a checked live vault, its collection is pinned by
address, and `new_owner` must equal the derived destination. Every other signed CPI in MINT uses other seeds
and constant program ids (`:735` Core/MINT_SEED, `:1026` and `:1070` SPL/System/REVENUE_SEED, `:1368` Core
UpdatePlugin/MINT_SEED, `:1733` SPL/CONFIG_SEED, `:2312` CreateV2/MINT_SEED). The one CPI that forwards
caller-supplied metas (`:1238`, the Core burn in the charter claim) is a plain `invoke` with no seeds. Another
program cannot derive MINT's PDA. Before step 11, the **upgrade authority** could add a second signing path. That
is the existing pre-final trust, now with a transfer power over every vault behind it.

**I2. Core semantics. CONFIRMED from local Core source (`e72d63e`).** `PermanentTransferDelegate` implements
only `validate_add_plugin` (it rejects being added after creation) and `validate_transfer`
(`force_approve` when the resolved authorities include its authority). It has no burn, update, execute or
plugin-management hook, so the delegate **cannot Burn, Update or Execute**. Remove, revoke and re-delegate by
the owner are refused (measured, R35.N8). ForceApproved short-circuits the plugin loop, so it overrides any
FreezeDelegate or PermanentFreezeDelegate on the vault (the basis of M1b). The seal (`PermanentFreezeExecute`)
only rejects Execute, so it neither blocks nor is weakened by the rescue. **NOT confirmed:** that mainnet Core
today is byte-identical to `e72d63e`. The suite clones the live program and exercises transfer and plugin
management against it, which covers the behaviour this change depends on.

**I3. Destination derivation and aliasing. CONFIRMED safe.**
* `host == vault`: Squads, correctly, because no key can sign for PDA(V).
* `host == collection`: `HostUnresolved`.
* `host == new_owner` (a host whose owner field is itself): the vault goes to that address, which is no worse
  than before.
* `host` is a fake "burned" account: impossible. `is_burned` requires a Core-owned, 1-byte, key-0 account,
  which only Core's `close_program_account` produces. A tombstone keeps one byte of rent and cannot be revived by
  CreateV2.
* A live host made to look burned, or the reverse: impossible.
* `bank_treasury` is written once at `initialize` (`:668`) and is not governable.
* Squads custody is reached only for true orphans: a burned host, or a self-nested vault. A holder cannot be
  griefed into Squads custody unless they orphaned the vault themselves.
* Chains resolve one level per call. A two-vault cycle resolves (V → PDA(V) → Squads, then H → Squads).

**I4. SEAL/BURN interplay. Safe.** Nobody can insert a rescue into someone else's open→burn transaction. If the
redeemer inserts one themselves, `burn_vault` re-checks the current owner against the `owner` bound by
`open_for_redemption`, and Core's BurnV1 needs that owner's signature, so the transaction reverts. The only
non-reverting variant (rescue to W, W sweeps, W transfers back, burn) produces exactly what a normal redemption
produces. An opened vault can never be routed to the Squads (both orphan shapes make `open` unsignable).
**Rate limit:** the rescue moves no reserve and burns nothing, so the 2.1% limit is not bypassed (V's own
reserves still need V's rate-limited redemption).
**GOV:** `VoteRecord` is seeded by the asset (`gov:850-854`), so a rescue cannot double-vote.
**reveal / activate / claim:** keyed by asset; payouts go to the vault's PDA and follow the vault.

**I5. Plugin order and size. Safe.**
* On chain, nothing reads plugins by offset. SEAL, BURN and GOV read only base bytes 0..66. `reveal_level` updates
  Attributes by plugin type through Core.
* Off chain, `web/src/lib/decode.mjs` walks the registry, and `bank/crank.mjs:794` uses the SDK deserializer.
  `bank/layout.mjs` hashes **collection** plugins only.
* The vault grows 43 bytes (1 tag + a 42-byte registry record), about 218k lamports at mainnet rent. No
  hard-coded rent was found in `web/`.
* `create_vault` now calls `find_program_address(["rescue"])` on every mint and charter claim (`:2294`). That
  costs a few thousand CU, inside the measured worst shapes (R34.G1a/b). Hard-coding the bump as a constant
  (asserted in the suite) would remove it.

**I6. Off-chain parsing is correct.**
* `parseCbobLogs` attributes `VAULT_RESCUED` only when MINT is on top of the invoke stack (the selftest proves
  a foreign program's line is ignored).
* `orphan` parses as a boolean.
* `vault_rescued_to_squads` is `once` and urgent; `vault_rescued` is `info`.
* `planRescue` (web) mirrors the on-chain derivation, including the `dest == owner` refusal.

**I7. Operational note.** Anyone can self-nest their own vault, rescue it to the Squads, and ask for it back,
over and over. Each cycle forces a manual multisig return and an urgent page. The runbook should allow the
Squads to decline or batch these.
