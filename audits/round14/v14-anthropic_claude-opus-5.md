# INDEPENDENT AUDIT — commit e16c5e2 (the repairs)

Scope note on method: for every finding below I state the artefact that would exist if I am right, so it can be checked mechanically. Where I could not settle a claim by reading, I say so rather than dressing it as a finding.

---

# R1 — `correlateBurns`

## R1-1 (HIGH) The repair downgrades one of *three* findings a routine redemption produces. `vault_vanished` still fires CRITICAL on every honest exit.

**Construct.** `correlateBurns` only rewrites `kind === 'vault_burned'` and `kind === 'burn_via_program'`. A redemption of an *activated* vault also produces, in `main()`:

```js
findings.push(...D.detectDeactivations(prev?.activation, balances, unreadable))
```

`balances` is built only from the **live** DAS list. When a redeemed vault leaves the live set, `prev.activation[asset] === true` and `current[asset] === undefined`, so `detectDeactivations` emits:

```js
{ kind: 'vault_vanished', severity: S.CRITICAL, asset, detail: 'vault … was activated and is no longer readable at all' }
```

`correlateBurns` never touches that kind. If instead DAS lags one pass (vault still listed, ATA already closed), the same redemption produces `reserve_fell` HIGH **and** `deactivated` HIGH from the same two detectors — also untouched.

So every customer exit still produces either one CRITICAL (`vault_vanished`) or two HIGHs (`reserve_fell` + `deactivated`), and `vault_left_index` — the sole detector for the bare Core `BurnV1` — is buried exactly as before. The repair fixed one of three sites. That is this project's own most-repeated defect shape, inside the commit written to remove it.

**What the accident gains.** Nothing changes for an attacker; what is lost is the entire purpose of the round-13 fix. Worse, the operator now has a *reason to believe* redemption noise was fixed, so the residual CRITICALs read as spurious and get filtered.

**Evidence if I am right.** Two consecutive `--dry-run` passes with one redemption in between (stub `listVaults` and `walkSigs`): pass N+1 prints `[vault_burned] … was REDEEMED` at INFO **and** `[vault_vanished] … was activated and is no longer readable at all` at CRITICAL, for the same asset. Statically: `grep -n "kind ===" bank/detectors.mjs` inside `correlateBurns` returns only `burn_via_program` and `vault_burned`.

**Fix.** Correlate the whole family, not one member. Give `correlateBurns` the same per-asset set and downgrade `vault_vanished`, `deactivated` and `reserve_fell` to INFO for an asset with a matched `burn_vault` — and add an assertion per kind so the next detector added to that family fails the selftest until it is classified.

## R1-2 (MEDIUM) The all-clear string now lies on the one pass shape the repair created.

**Construct.** `report()` prints, when `crit.length || high.length` is zero:

```
'no approvals, no unexpected PDA token accounts, no nested vaults, no burn this
pass could not account for, no vault left the
collection, …'
```

For an **unactivated** vault (`prev.activation[asset] === false`, so `detectDeactivations` skips it, and `detectBalanceDrops` skips a `current[asset] === undefined`), a redemption yields exactly two INFO findings and zero CRITICAL/HIGH. The pass then prints "**no vault left the collection**" while listing an INFO finding saying the vault was burned and left the collection.

**Evidence.** Same harness as R1-1 with the vault below 21,000 sats: the report body contains both `[vault_burned] … was REDEEMED` and the sentence `no vault left the collection`.

**Fix.** The all-clear must be computed from what was found, not from a constant string. Emit each clause only when the corresponding detector produced nothing at all (INFO included), or drop the clause.

## R1-3 (MEDIUM) `report()` prints that same all-clear from `--reconcile`, which checks almost none of it.

**Construct.** `reconcile()` runs `detectIndexShortfall`, `detectNestedVaults` and `detectUndeclaredTokenAccounts`, then calls `report(findings, {...}, cfg, false)`. `idle === false`, so on a clean day the daily job prints "no approvals, no unexpected PDA token accounts, …, no unreconciled sweep, and no drift in any config value, program upgrade authority, program bytes or the collection." It called `readConfigs()` but never called `detectConfigDrift`, `detectStandingRisks`, `detectBankIsNotSignable`, `detectApprovals`, `detectBurns`, `detectUnledgeredSweeps` or `detectSplitClaims`.

This is the class the project keeps finding (a claimed control that did not run), except it is in the *report a human reads*, not a comment. The round-13 edit added two more clauses to that string without noticing the second caller.

**Evidence.** `node bank/alarm.mjs --reconcile` against a chain with a live config drift prints the drift-free all-clear.

**Fix.** Pass the list of checks that ran into `report()` and print only those clauses; or give `reconcile()` its own footer.

## R1-4 (LOW) `burn_via_program` does not verify the asset is one of ours, so the correlation key is caller-supplied.

**Construct.** The Core branch of `detectBurns` gates on `if (!assetSet.has(asset)) continue`. The `burnProgramId` branch does not — it takes `ix.accounts?.[0]` from any instruction to BURN whose first 8 data bytes match the `burn_vault` discriminator, top-level *or inner*, and feeds it straight into `correlateBurns`' `viaProgram` set.

I could **not** construct a working laundering path from this: the alarm skips `s.err` transactions, a top-level `burn_vault` for a foreign asset cannot succeed (`NoPrecedingOpen` / `NotACoreAsset` against the tombstone), and a failed CPI aborts the transaction. So this is not exploitable today. It is exploitable the moment anything changes — e.g. if the alarm ever scans failed transactions (which it arguably should, to see attempts), or if BURN gains any instruction that reaches the same discriminator prefix. A correlation key that decides whether a CRITICAL is silenced should not be attacker-supplied.

**Fix.** `if (!assetSet.has(asset)) continue` in both branches, and record the asset only from instructions the walk observed as **top-level**.

## R1-5 (LOW) Downgrading `burn_via_program` to INFO removes the only signal for a `burn_vault` the DAS diff never sees.

If DAS never lists an asset (indexer fault, or the vault-set baseline was reset by `--first-run`), `vault_burned` never fires, and the only remaining trace of a destruction is now an INFO line nobody is paged for. The severity choice is defensible; the compensating assertion is not present. State it in the detector's blind-spot list.

---

# R2 — `MAX_RESERVE_MINTS` 8 → 3

## R2-1 (HIGH) The harness measures a transaction no production client can send. 1090/1232 is not 142 bytes of headroom; it is roughly zero.

**Construct.** Test 9.14 builds `ixOpen + ExecuteV1(transfer+close per mint) + ixBurn`, sets a dummy blockhash, and serializes. It never sends. Cross-checked against 4.6 (which *did* land) the N=1 figure agrees at 802 bytes, so the harness is structurally faithful **to that transaction**. The problem is what a real redemption must additionally carry:

| addition | why it is not optional | bytes |
|---|---|---|
| `ComputeBudget` program key + `setComputeUnitLimit` + `setComputeUnitPrice` | a priority fee is how a transaction lands on mainnet under load; CU is unmeasured so a limit will be needed | 32 + 8 + 8 |
| `AssociatedTokenAccount` program key + 3 × `createAssociatedTokenAccountIdempotent` for the customer's destination ATAs | a redeemer will not already hold ATAs for all three reserve assets; the harness's `dst` never has to exist because the tx is never executed | 32 + ~30 |
| the PDA lamport sweep inside `ExecuteV1` | mandatory whenever anyone has funded the asset-signer PDA (measured 9.10/9.11); an adversary controls whether it is needed | ~20–30 |

That is ~130–140 bytes on top of 1090, i.e. **1220–1230 of 1232**, before a durable nonce (+~40) or a third-party fee payer (+32 key +64 signature). The margin the constant was set on does not exist for any client that has to create a destination ATA or pay a priority fee.

Because the reserve list is additive-only and the business has exactly three assets, the config will sit permanently *at* the cap. So the kill switch identified in round 13 was not removed — it was set to the boundary, and whether it trips is now decided by a redemption client that has not been written.

**Evidence if I am right.** Extend 9.14: build the same transaction plus 2 ComputeBudget instructions, 3 idempotent-ATA instructions and a PDA lamport sweep, and serialize. It will be within ~15 bytes of 1232 at N=3, and over it with a separate fee payer or a nonce.

**Fix, in order.**
1. Cap at **2** until a redemption client exists and a **landed** 3-mint redemption is measured on the validator (bytes *and* CU), or
2. Remove the dead Token-2022 ATA declarations first (see V-2 below): that is ~99 bytes at N=3, taking 1090 → ~991 and restoring real margin. The round-13 verdict carried this as "cheapest capacity available"; on these numbers it is the difference between a workable and an unworkable 3-mint redemption, and it should be done *before* the cap is trusted at 3.
3. Add an assertion that **sends** the N=3 redemption, not one that serializes it.

## R2-2 (MEDIUM) Compute units are unmeasured and the two ceilings are coupled.

Nothing in the repository measures CU for any redemption. A 3-mint redemption executes: `read_core_asset`; a forward `load_instruction_at_checked` walk (each call deserializes a full instruction); a Core `UpdatePluginV1` CPI; a Core `ExecuteV1` with six inner CPIs; a backward introspection walk; **six** `find_program_address` calls in BURN's reserve loop (3 mints × 2 token programs, each ~1.5–3k CU); the second `remaining_accounts` loop; and a Core `BurnV1` CPI. My arithmetic puts that in the 150–300k range, which fits the default `200_000 × n_instructions` budget — but that is an estimate, not a measurement, and the moment a limit instruction is required to buy priority it consumes bytes from R2-1's non-existent margin.

**Fix.** Log CU consumed for the landed N=1/2/3 redemptions (`getTransaction().meta.computeUnitsConsumed`) and pin it in the suite alongside the byte count, exactly as bytes are pinned.

## R2-3 (LOW) 9.14's derived number is a count, not a maximum, and any exception reads as "too big".

`const fits = sizes.filter(b => b <= 1232).length` is the *number of sizes under the limit*, and `catch { sizes.push(99999) }` turns any construction failure — a umi change, a missing ATA derivation, an RPC hiccup inside `sizeFor` — into "does not fit". Non-monotonic or partially-failing results silently produce a wrong `fits`, and 9.15/9.16 then demand the constants equal that wrong number. Today the direction happens to be safe (a broken `sizeFor` lowers `fits` and turns the suite red), but the assertion does not verify that the fitting set is a contiguous prefix, and it does not distinguish "too large" from "could not build".

**Fix.** Assert `sizes[0] <= 1232`, assert monotonic growth, and record a build failure as a distinct `rec()` mismatch rather than as 99999.

## R2-4 (LOW) Nothing in the repository builds a v0 transaction or an address lookup table.

The SEAL comment is accurate that an ALT would be required for a fourth mint, and I confirmed the mechanism works in principle: the instructions sysvar exposes *resolved* pubkeys, so both introspection walks are unaffected by ALT compression. What the comment does not say is that signers and the fee payer cannot be table-compressed, so the saving is on the ~(17 + 4n − 3) non-signer keys only. That is still large (≈31 bytes per compressed key), so ALT genuinely raises the ceiling — but the claim "a fourth reserve mint is not a config change" is the operative one and it is correct only because the cap now refuses it.

---

# R3 — `detectNestedVaults`

## R3-1 (CRITICAL) The detector catches the narrow subcase and misses the general one: a vault owned by *any* address that cannot sign is unredeemable, undetected, and — via a CPI-composed `mint_vault` — reachable by an ordinary multisig buyer.

**Construct, part 1 (the detection gap).** `owners` is built only from PDAs of assets **in our collection**:

```js
for (const v of vaults) { const p = pdaOf(v.id); if (p) owners.set(p, v.id) }
…
const host = owners.get(owner); if (host === undefined) continue
```

So a CBOB vault transferred to *any* other off-curve address — a foreign Core asset's signer PDA, a Squads vault, a staking program's PDA, a fake "vault-boost" address — is silently quiet. It stays live in the collection, so `detectVaultSetChange` says nothing; it never turns burnt, so `vault_burned`/`vault_left_index` say nothing; its reserve does not move, so `detectBalanceDrops` says nothing. A customer's Bitcoin is permanently sealed and the pipeline reports "all clear". The documented blind spot is the *opposite* direction ("a FOREIGN Core asset nested inside a vault"), so the honesty claim in R3 is inverted: the stated gap is the harmless one and the unstated gap is the fatal one.

**Construct, part 2 (the reachable accident).** MINT's `owner: Signer` requirement is documented as closing this:

> "There is NO on-chain way to test an address for this… Requiring a SIGNATURE is the enforceable form of the same property, and it is strictly stronger: it proves someone actually holds the key today."

That is false. `is_signer` is true for a PDA passed as a CPI signer. A Squads execution — or any program signing for its own PDA — can satisfy `owner: Signer` with an off-curve address, because `mint_vault` has no instruction introspection. The resulting vault can never be redeemed: `open_for_redemption` is reachable only from inside the same CPI, `load_current_index_checked` returns the **outer** index, and the forward scan finds no top-level `burn_vault` → `NoTerminalBurn`, forever. This is *exactly* the mechanism the round-13 finding accepted for the Bank; the repair checked the Bank and not the owner.

So a DAO or a treasury that buys a charter vault from its Squads vault pays real money, deposits real cbBTC, and receives a permanently sealed asset. Nothing on-chain refuses it and nothing off-chain reports it.

**Evidence if I am right.**
- Off-chain: `D.detectNestedVaults([{id: V, owner: 'bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1'}], pdaOf)` returns `[]`.
- On-chain: add a two-instruction wrapper program to the suite that CPIs `mint_vault` with its own PDA as `owner`; the mint succeeds. Then attempt `open_for_redemption` + `burn_vault` via the same wrapper: `NoTerminalBurn`. Test 5.2 does **not** cover this — it passes the PDA with `isSigner:false` and is refused by `AccountNotSigner`, which is a different property.

**Fix (both halves).**
1. **Off-chain, one line, using a primitive already imported in this commit:** in the same DAS loop, `if (!isOnCurve(owner)) → CRITICAL vault_owner_cannot_sign`. There is no false-positive class: `mint_vault` requires the owner to sign, so an off-curve owner is *always* an anomaly, and it is *always* unredeemable (a Squads-owned vault fails the pairing identically to a Squads Bank — the author's own reasoning).
2. **On-chain, and this one is enforceable:** make `mint_vault` require that it is itself a **top-level** instruction — `load_current_index_checked` plus `load_instruction_at_checked(current)` must report this program and this data. A CPI-composed mint is then refused, which is the only route to a PDA owner. The same trick is already used twice in this codebase. Trade-off, deliberate: a Squads-executed mint to a *keypair* owner is also refused; that is the correct side to err on, and it can be relaxed later by binding the wrapper explicitly.
3. Delete the "strictly stronger" claim from MINT and from SPEC ("A PDA owner cannot redeem, so `mint_vault` requires the owner to sign"), which is the load-bearing false sentence.

## R3-2 (MEDIUM) Every nesting incident becomes a permanent, un-answerable CRITICAL — the failure mode this project has fixed three times elsewhere.

**Construct.** The inner loop iterates *all* vaults including burnt ones and has no `resolvedBy` escape. Nesting cannot be undone (a PDA cannot sign a Core transfer out). So the first time anyone nests a vault — or the first time a host is burned with an undeclared inner vault (measured 9.5, the normal exit under v5) — the alarm emits a CRITICAL every 30 minutes forever, with no remedy that exists and no way for a human to acknowledge it. `detectDistribution` learned `resolvedBy` in round 10 and had it extended in round 11 after precisely this reasoning; the brand-new detector shipped without it.

**Consequence.** The operator suppresses the detector, and with it the only instrument that sees nesting at all.

**Evidence.** `grep resolvedBy bank/detectors.mjs` — present in `detectDistribution`, absent in `detectNestedVaults`.

**Fix.** Accept an acknowledgement set (persisted in alarm state, keyed by `{inner, host}`) and downgrade an acknowledged pair to INFO while keeping it visible. Report the *first* observation at CRITICAL and repeats at INFO.

## R3-3 (LOW) Burnt hosts: right call, wrong scope note.

Including burnt hosts is correct — a burned host's PDA can never sign, so an inner vault there is already lost. But the detector also treats a **burnt inner** vault as a live nesting finding, which is a report about an already-completed destruction dressed as a pending one. Distinguish `nested_vault` (inner live) from `nested_vault_destroyed` (inner burnt or host burnt) so the operator can tell "act now" from "post-mortem".

## R3-4 (LOW) Can DAS make it fire on a healthy vault, or miss a nested one?

Fire falsely: no. `ownership.owner` for a healthy vault is a wallet, and a wallet address cannot equal a `find_program_address` output. Miss one: yes, in two ways — before DAS indexes the transfer (stated), and whenever the host is outside the collection (R3-1). One more, unstated: `ownership.owner` for a **frozen/delegated** asset is still the owner, so the delegate case is invisible — irrelevant here because the freeze plugin is `PermanentFreezeExecute`, not a transfer delegate.

---

# R4 — `detectBankIsNotSignable`

## R4-1 (HIGH) It checks the *live* bank and not the *pending* one, so it can only report the outage after it has begun.

**Construct.** The detector iterates a hardcoded list:

```js
for (const key of ['seal.bank', 'burn.bank', 'mint.bank'])
```

`readConfigs` also produces `seal.pending_bank`, `burn.pending_bank`, `mint.pending_bank`, and all three are in `WATCHED_KEYS`. The pending window is the **only** period in which the mistake is preventable: `cancel_pending` costs one transaction. Once `apply_pending` lands (permissionless — anyone can complete it), redemptions halt and recovery requires a fresh rotation plus a seven-day notice period. The detector's own text says so: "Every redemption is halted