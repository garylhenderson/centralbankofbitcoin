

## R1 — `correlateBurns` / burn severity changes

### R1-1 HIGH — `correlateBurns` trusts `burn_via_program` findings that are not constrained to TOP-LEVEL successful `burn_vault`
Exact construct:
- `bank/alarm.mjs` `normalise()` returns `[...top, ...inner]` with no marker distinguishing top-level instructions from CPI inner instructions.
- `bank/detectors.mjs` `detectBurns()` emits `burn_via_program` for any instruction whose `program === burnProgramId` and whose first 8 bytes match `IX_BURN_VAULT_DISC`, including inner instructions.
- `correlateBurns()` builds `viaProgram` from every `burn_via_program` finding and downgrades any `vault_burned` for the same asset to INFO.

The on-chain invariant is stricter: SEAL only accepts a **top-level** `burn_vault`, and BURN only accepts a **top-level** `open_for_redemption`. The off-chain correlation is therefore not isomorphic to the on-chain rule.

Attack shape:
1. Deploy an arbitrary wrapper program.
2. In one successful transaction, CPI `burn_vault` for asset X with a deliberately invalid signer set (e.g. Bank not a signer), catch the error inside the wrapper.
3. In the same transaction, CPI a bare Core `BurnV1` for asset X (owner-signed).
4. If the RPC’s `innerInstructions` includes the caught failed CPI — or if a future parser change includes it — the alarm emits `burn_via_program` for X and `correlateBurns` launders the bare burn to INFO.

What the attacker gains: silence on the one event `vault_burned` exists to catch.

Evidence that would exist if this is real:
- On a validator, deploy a tiny wrapper that CPIs `burn_vault` invalidly, catches the error, then CPIs Core `BurnV1`.
- `getParsedTransaction(...).meta.innerInstructions` will show whether the failed BURN CPI is present.
- Feed that transaction through `normalise()` and `detectBurns()`. If a `burn_via_program` finding appears for X, `correlateBurns` will downgrade a matching `vault_burned`.

Fix:
- `normalise()` must tag each instruction as `topLevel` or `inner`.
- `detectBurns()` should emit different kinds, e.g. `burn_via_program_top` and `burn_via_program_inner`.
- `correlateBurns()` must only use top-level successful `burn_vault` findings. Since the on-chain pairing requires top-level instructions, this loses no legitimate correlation and removes a whole class of parser/RPC dependence.

---

### R1-2 MEDIUM — The “fails safe / self-correcting” claim is wrong for one ordering: signature walk sees the burn before DAS does
Exact construct:
- Pass N: signature walk sees a legitimate redemption and emits `burn_via_program` INFO. DAS has not yet marked the asset burnt, so `detectVaultSetChange` emits no `vault_burned`.
- `alarm.mjs` advances the signature cursor and stores the current live vault list.
- Pass N+1: DAS now marks the asset burnt. `detectVaultSetChange` emits `vault_burned` CRITICAL. The redemption transaction is no longer in the signature window because the cursor advanced. `correlateBurns` sees no `burn_via_program`, so the finding stays CRITICAL.

This is not a fail-open for an attack, but it is a false CRITICAL that the comment claims is “self-correcting” when it is not: the next pass does **not** see both instruments; it sees only DAS.

What an accident gains: alert fatigue. Repeated false CRITICALs on legitimate redemptions are exactly how real CRITICALs get ignored.

Evidence:
- Mock two passes:
  - Pass 1: `walkSigs` returns the redemption tx; `listVaults` still returns the asset live.
  - Pass 2: `walkSigs` returns nothing new; `listVaults` returns the asset burnt.
- The pass-2 report contains an uncorrelated `vault_burned` CRITICAL.

Fix:
- Persist a short-lived set of recently seen `burn_via_program` assets (e.g. 2–4 passes) and allow `correlateBurns` to use that state, not only current-pass findings.
- Alternatively, do not advance the signature cursor past a transaction that names a vault asset until DAS has also observed the burn. That is heavier; a small state map is simpler.

---

### R1-3 MEDIUM — Downgrading `vault_burned` to INFO removes the only same-pass signal that a program burn destroyed undeclared value
Exact construct:
- `correlateBurns()` downgrades `vault_burned` to INFO whenever `burn_via_program` for the same asset exists.
- The downgrade text says “Anything undeclared is still orphaned — that is what the nested-vault and undeclared-account detectors are for.”
- But those detectors are post-hoc and incomplete:
  - `detectNestedVaults` sees only CBOB vaults.
  - `detectUndeclaredTokenAccounts` runs only in `--reconcile`, daily.
  - Foreign Core assets nested in a vault are not detected anywhere.

Attack/accident:
- A third party airdrops value into a vault PDA in a token account or foreign Core asset that the 30-minute pass cannot see.
- The owner redeems through `burn_vault` without declaring it.
- The burn succeeds and destroys the undeclared holding.
- The alarm reports the burn as INFO, not CRITICAL.

What the attacker gains: destruction of value with no same-pass CRITICAL.

Evidence:
- On a validator, create a vault, create a non-ATA token account owned by the vault PDA without touching any watched program, fund it, then redeem without declaring it.
- The alarm pass containing the redemption will show `burn_via_program` and `vault_burned` downgraded to INFO if no other detector fired.

Fix:
- Until a Bank co-signing tool exists, do not downgrade to bare INFO. Downgrade to HIGH with a distinct kind such as `redemption_completeness_unverified`, or require a recent clean reconcile for that asset before downgrading.
- If noise is unacceptable, add a per-asset “clean reconcile” state and only downgrade when the asset was reconciled clean within the last 24 hours.

---

### R1-4 LOW — `burn_via_program` was made INFO even when it appears without any corresponding `vault_burned`
Exact construct:
- `detectBurns()` emits INFO for every successful `burn_vault`.
- If DAS is broken, lagging indefinitely, or returns a stale live entry for a burned vault, the only same-pass evidence of the burn may be an INFO finding.
- `detectBalanceDrops` or `detectDeactivations` may fire for activated vaults, but an unactivated vault can burn with only INFO.

What an accident gains: a successful redemption can be visually buried if DAS does not confirm it.

Evidence:
- Mock `listVaults` to keep a burned asset live. The pass contains only INFO `burn_via_program`, no CRITICAL/HIGH from vault-set change.

Fix:
- If a `burn_via_program` asset remains in the DAS live set for the next pass, raise HIGH for “program burn seen but index has not marked asset burnt”.

---

### R1-5 LOW — `bare_core_burn` findings are not deduplicated across program walks
Exact construct:
- A transaction that touches two watched programs and contains a bare Core `BurnV1` is fetched in both signature walks.
- `correlateBurns()` deduplicates `burn_via_program` but not `bare_core_burn`.

What an attacker/accident gains: duplicate CRITICALs, noise.

Evidence:
- Feed the same transaction through two program walks and inspect findings after `correlateBurns`.

Fix:
- Deduplicate by `kind + asset + signature` for all burn-related findings.

---

## R2 — `MAX_RESERVE_MINTS = 3` and the measurement harness

### R2-1 HIGH — Test 9.14 does not measure the worst-case production redemption transaction
Exact construct in `tests/3prog.test.ts` 9.14:
- Uses `tx.serialize({requireAllSignatures:false, verifySignatures:false})`.
- Fee payer is Bank; owner is Alice. It does not prove the serialized length includes all required signature slots, and it does not test a distinct payer.
- Assumes every destination ATA already exists. It does not include `createAssociatedTokenAccountIdempotentInstruction` for owner receive accounts.
- Uses `createTransferInstruction` (unchecked), not `createTransferCheckedInstruction`.
- Uses one Core `ExecuteV1` containing all sweeps. A different client may use multiple `ExecuteV1` instructions.
- Does not include compute-budget instructions, which are common in production clients.

Why this matters:
- The cap is now an on-chain product bound. If the real worst-case 3-mint redemption exceeds 1232 bytes, vaults holding three reserves become unredeemable unless the owner performs pre-transactions or uses a canonical builder that does not exist in this repository.
- The reported headroom is 142 bytes. That is small enough that destination ATA creation, checked transfers, a third signature, or priority-fee instructions can cross the limit.

What an accident gains: a hard redemption halt for the exact three reserve assets the business says it has.

Evidence that would exist if this is right:
- Modify 9.14 to:
  1. Sign with real keypairs or otherwise assert the serialized length equals a fully signed legacy transaction.
  2. Add idempotent ATA creation for every owner destination mint account.
  3. Use `createTransferCheckedInstruction`.
  4. Add a distinct payer if operationally possible.
  5. Add a compute-budget instruction pair.
  6. Build both one-Execute and per-mint-Execute variants.
- If any of those variants for `n=3` exceeds 1232 bytes, the current harness measured a narrower case than production.

Fix:
- Make 9.14 measure the worst permitted redemption shape, not the most efficient one.
- If worst-case 3 does not fit, either:
  - require and enforce operationally that destination ATAs pre-exist and the canonical builder is used, and say that in SPEC; or
  - move redemption to versioned transactions with ALT before relying on 3; or
  - reduce the reserve set actually usable at redemption until a canonical client exists.
- Do not leave `MAX_RESERVE_MINTS` justified by a best-case serialization.

---

### R2-2 MEDIUM — The harness does not prove signature-byte inclusion
Exact construct:
- `requireAllSignatures:false` and `verifySignatures:false` are used.
- The test does not compare unsigned and signed serialized lengths.

Why this matters:
- If web3.js omits missing signature placeholders in this mode, every reported size is short by 64 bytes per required signature.
- Redemption requires at least Bank and owner. A separate payer would add another.

Evidence:
- Serialize the same transaction unsigned, then sign with Bank and Alice and serialize again.
- If the signed length is larger by 128 bytes, the 3-mint “1090” measurement is actually 1218, leaving 14 bytes, not 142.
- If a distinct payer is added, it becomes 1282 and does not fit.

Fix:
- Assert signed length, or assert unsigned length equals signed length when using placeholders.
- Record the signature count used in the measurement.

---

### R2-3 MEDIUM — Compute units are still unmeasured, and a byte ceiling is not a transaction ceiling
Exact construct:
- 9.14 measures bytes only.
- A 3-mint redemption includes:
  - SEAL introspection loop over later instructions.
  - BURN introspection loop over earlier instructions.
  - BURN reserve loop over 3 mints × 2 token programs.
  - BURN second loop over all declared accounts.
  - Core `ExecuteV1` CPI with 6 inner token instructions.
  - Core `BurnV1` CPI.

What an accident gains: a 3-mint redemption can fit in 1232 bytes and still fail with CU exhaustion.

Evidence:
- Run the 3-mint redemption through `simulateTransaction` and read `unitsConsumed`.
- Add a `ComputeBudgetInstruction.setComputeUnitLimit` probe. If the required limit is near or above the transaction maximum, the byte cap is not the real cap.

Fix:
- Add a CU measurement to 9.14 or a sibling test.
- Make the reserve cap depend on `min(byte_ceiling, cu_ceiling)`.

---

### R2-4 MEDIUM — Cap 3 plus additive-only reserve list removes all mint-replacement headroom
Exact construct:
- `MAX_RESERVE_MINTS = 3`.
- `update_config` requires every old mint to remain in the new list.
- The business already has three reserve mints.

What an accident gains:
- If one reserve mint must be replaced — freeze abuse, issuer compromise, migration, operational mistake — the list cannot add a fourth and cannot drop the bad one.
- A frozen reserve ATA can make `burn_vault` impossible because the sweep cannot empty it. The vault is then sealed with contents intact, but redemption is halted for that asset.

Evidence:
- With three configured mints, call `update_config` with the same three plus a fourth: `TooManyReserveMints`.
- Call it with two of the three: `ReserveMintDropped`.

Fix:
- Document a reserve-mint migration plan that requires program upgrade and possibly ALT/versioned redemption.
- Consider a governed “replace with proof old mint is unusable” path before mainnet minting, or accept this as a hard business risk explicitly.

---

### R2-5 LOW — The harness uses unchecked transfers; checked transfers are larger
This is a subset of R2-1 but worth naming because the difference is mechanical:
- `createTransferInstruction` has 3 accounts and 9 bytes of data.
- `createTransferCheckedInstruction` has 4 accounts and 10 bytes of data, and may force the mint account into the message account table if not already present.

Fix: measure checked transfers if any production client may use them.

---

## R3 — `detectNestedVaults`

### R3-1 MEDIUM — The detector comment falsely assigns foreign-Core-asset detection to `--reconcile`
Exact construct:
- `bank/detectors.mjs` `detectNestedVaults` comment says:
  > a FOREIGN Core asset ... needs a per-vault DAS owner search and is the reconcile's job, not this one's.
- `bank/alarm.mjs` `reconcile()` only calls `getTokenAccountsByOwner` for SPL and Token-2022. It does not query DAS by owner for Core assets.

What an attacker/accident gains:
- A foreign Core asset nested in a vault PDA can be destroyed by `burn_vault` with no detector ever naming it.
- The comment creates the impression a control exists when it does not.

Evidence:
- Grep `reconcile()` for `getAssetsByOwner` or any DAS owner query: absent.
- On a validator or mocked DAS, place a foreign Core asset under a vault PDA and run `--reconcile`: no finding.

Fix:
- Either implement the missing reconcile check: for each vault PDA, query DAS `getAssetsByOwner` and report any Core asset that is not a declared CBOB vault; or
- Rewrite the comment to say “nothing detects this today” and make the all-clear text say “no nested CBOB vaults”, not “no nested vaults”.

---

### R3-2 LOW — Burnt inner vaults owned by burnt hosts will fire CRITICAL forever
Exact construct:
- `detectNestedVaults` deliberately includes burnt hosts.
- It does not use the `burnt` flag on the inner vault.
- If DAS preserves owner information for burnt assets, a historical destruction can produce an endless CRITICAL.

What an accident gains: alert fatigue after the loss has already happened and no action remains.

Evidence:
- Feed `[{id: OUTER, owner: HUMAN, burnt: true}, {id: INNER, owner: OUTER_PDA, burnt: true}]`.
- The detector emits CRITICAL `nested_vault`.

Fix:
- Keep CRITICAL when the inner vault is live and the host is live or burnt.
- If both are burnt, emit HIGH/INFO “nested vault already destroyed” with a resolution path, or baseline it so it does not re-alert every pass.

---

### R3-3 LOW — `pdaOf` can throw on malformed DAS ids and abort the whole pass
Exact construct:
- `alarm.mjs` calls:
  `id => pda([Buffer.from('mpl-core-execute'), new PublicKey(id).toBuffer()], CORE).toBase58()`
- If DAS ever returns a malformed id, `new PublicKey(id)` throws.

What an attacker/accident gains: a DAS poisoning or index bug can stop the alarm pass. The failure is loud, but it converts bad index data into watcher downtime.

Evidence:
- Call `detectNestedVaults` through the alarm lambda with `id: 'not-a-pubkey'`; it throws.

Fix:
- Wrap the `pdaOf` lambda: return `null` for invalid ids and emit a HIGH `das_malformed_asset_id` finding.

---

## R4 — `detectBankIsNotSignable`

### R4-1 MEDIUM — Off-curve is a necessary but not sufficient proxy for “Bank can sign top-level redemption instructions”
Exact construct:
- The detector only reports when `PublicKey.isOnCurve(bank) === false`.
- It acknowledges blindness to an on-curve key operated through a relayer/wrapper.

Why this matters:
- The pairing failure is not caused by off-curve itself; it is caused by `open_for_redemption` and `burn_vault` becoming inner CPI instructions.
- An on-curve Bank key can still be used in a transaction where a wrapper program CPIs the redemption instructions. The Bank signature can be present at top level, the detector can stay quiet, and the on-chain pairing can refuse.

What an accident gains: silent redemption halt while the watcher says the Bank is signable.

Evidence:
- Build a wrapper program that takes a Bank signature on the outer transaction but CPIs `open_for_redemption` and `burn_vault`.
- `detectBankIsNotSignable` returns no finding because the Bank pubkey is on-curve.
- The on-chain transaction fails with `NoTerminalBurn` or `NoPrecedingOpen`.

Fix:
- Keep the off-curve check, but state in SPEC that it only detects the multisig/PDA case.
- When the Bank co-signing tool is built, it must refuse any transaction where `open_for_redemption` or `burn_vault` is not a top-level instruction.
- In the alarm, add a detector for transactions signed by the Bank that contain inner calls to SEAL `open_for_redemption` or BURN `burn_vault`.

---

### R4-2 LOW — Admin exemption is correct for the stated reason, but arbitrary off-curve admin PDAs are not checked
I cannot name an admin instruction that breaks under a Squads PDA admin. The admin instructions are single top-level calls with no introspection:
- SEAL: `initialize`, `update_config`, `cancel_pending`.
- BURN: `initialize`, `update_config`, `cancel_pending`.
- MINT: `initialize`, `update_wiring`, `set_paused`, `set_collection_royalties`, cancel/apply rotations where admin is required.
- GOV: `initialize`, `update_gov_config`, `cancel_pending_admin`.

A Squads vault can sign these by CPI.

However, “off-curve” does not mean “signable”. If admin is rotated to an off-curve PDA that no program can sign for, admin functions become dead. The detector deliberately does not check admin, and rotation drift will fire, but there is no specific “admin is unsignable” finding.

Fix:
- Optionally add a standing check that admin is either the known Squads vault or an on-curve key, if the production admin is meant to be a specific multisig.

---

## R5 — Core drift watch

### R5-1 MEDIUM — `acc.data.subarray(45)` is only correct when the upgrade authority is present
Exact construct in `bank/alarm.mjs`:
```js
const hasAuth = acc.data[12] === 1
snap[`prog.${name}.upgrade_authority`] = hasAuth ? ... : 'IMMUTABLE'
snap[`prog.${name}.hash`] = createHash('sha256').update(acc.data.subarray(45)).digest('hex').slice(0, 32)
```

ProgramData layout:
- `[0..4]` enum
- `[4..12]` slot
- `[12]` Option authority
- if authority present: `[13..45]` authority, ELF starts at 45
- if authority absent: ELF starts at 13

If a watched program is immutable, this hashes from byte 45 and skips the first 32 bytes of the ELF. For Core, the authority is expected to be present today, but the detector is supposed to notice when the authority changes to `IMMUTABLE`. After that change, the hash baseline is computed from the wrong offset.

What an accident gains: a byte change in the first 32 bytes of an immutable program could be missed by the hash. The authority drift finding would fire on transition, but the hash control is structurally wrong for the immutable case.

Evidence:
- Dump an immutable upgradeable program’s ProgramData account.
- Compare `sha256(data.subarray(45))` with `sha256(data.subarray(13))`. They differ.
- If the first 32 ELF bytes change while authority remains absent, only the wrong-slice hash is compared.

Fix:
```js
const elfStart = hasAuth ? 45 : 13
snap[`prog.${name}.hash`] = sha256(acc.data.subarray(elfStart))
```
Also validate `acc.data.length >= elfStart`.

---

### R5-2 MEDIUM — `NO_PROGRAMDATA` sentinel can become a quiet steady state
Exact construct:
- If Core ProgramData is absent, `readConfigs` writes:
  - `prog.core.upgrade_authority = 'NO_PROGRAMDATA'`
  - `prog.core.hash = 'NO_PROGRAMDATA'`
- There is no standing CRITICAL for `prog.core._missing` or for the sentinel values.

Failure sequence:
1. First pass cannot read Core ProgramData due to RPC issue, wrong loader derivation, or provider corruption. Baseline becomes `NO_PROGRAMDATA`.
2. Every later pass that also fails to read Core produces no drift and no standing finding.
3. The report can read calm while Core is not actually being watched.

What an accident gains: exactly the silent unwatched Core the repair was meant to close.

Evidence:
- Mock two consecutive passes where Core ProgramData is absent. The second pass emits no CRITICAL for Core absence.

Fix:
- Add a standing CRITICAL when `prog.core._missing` is true or when either Core value is `NO_PROGRAMDATA`.
- If first-run adoption is desired, require an explicit `--first-run` or environment flag for Core sentinel adoption.

---

### R5-3 LOW — ProgramData parsing does not validate the enum or minimum length
Exact construct:
- The code reads `acc.data[12]` and hashes `subarray(45)` without checking `acc.data.length >= 45` or `acc.data.readUInt32LE(0) === 3`.

What an accident gains: a malformed or unexpected ProgramData account can produce garbage hashes or throw.

Fix:
- Validate enum == 3.
- Validate length before reading authority/hash.
- Report `prog.<name>._malformed` as CRITICAL.

---

## R6 — assertion floors

### R6-1 MEDIUM — `bank/selftest.mjs` internal floor is stale: 195 against a 221-assertion suite
Exact construct:
- `scripts/run-tests.sh` sets `DET_FLOOR=221`.
- `bank/selftest.mjs` ends with:
  ```js
  const FLOOR = 195
  ```

What this means:
- Running `node bank/selftest.mjs` directly allows deletion of up to 26 assertions while still exiting 0.
- The runner catches it, but the selftest’s own floor is the same “floor below reality” class the project has already been burned by.

Evidence:
- Delete 20 assertions from `bank/selftest.mjs`.
- `node bank/selftest.mjs` exits 0 if remaining count >= 195.
- `scripts/run-tests.sh` fails, proving the mismatch.

Fix:
- Set the internal floor to 221.
- Better: export the expected count from one place and have both the selftest and runner use it.

---

### R6-2 LOW — The runner floor checks only the numerator, not passed/total equality
Exact construct:
```bash
floor(){ ... n=$(grep -oE "$3" <<<"$2" | grep -oE '^[0-9]+' | tail -1) ... }
```
- It extracts the first number before `/`.
- It relies on the selftest exit code for failures.

If the selftest exit logic ever breaks, the runner floor would accept `221/300` as long as the process exits 0.

Evidence:
- Temporarily force selftest to print `221/300 detector assertions as predicted` and exit 0. The floor passes.

Fix:
- Parse both numerator and denominator.
- Require numerator == denominator and numerator >= floor.

---

## R7 — account sizing after `MAX_RESERVE_MINTS` change

### R7-1 LOW — SEAL `Initialize` space is arithmetically correct but the expression order does not match struct order
Exact construct:
```rust
space = 8 + 1 + 32 + 32 + 32 + 4 + (32 * MAX_RESERVE_MINTS) + 1
        + 32 + 8 + 32 + 8 + CONFIG_PADDING
```
The `Config` struct order is:
- version
- admin
- collection
- bank
- reserve_mints
- pending_bank
- pending_bank_at
- pending_admin
- pending_admin_at
- bump

The space expression inserts the bump byte before the pending fields. The total is the same, but this is the kind of mismatch that has produced real defects in this repo.

Evidence:
- Sum fields by struct order and by expression order; totals match.
- No runtime bug today.

Fix:
- Rewrite the expression in struct order:
  `8 + 1 + 32 + 32 + 32 + 4 + 32*MAX + 32 + 8 + 32 + 8 + 1 + PADDING`.

---

### R7-2 LOW — BURN does not use `MAX_RESERVE_MINTS` in its config space, despite the prompt’s concern
BURN’s `BurnConfig` has no reserve list. Its space expression is independent. The cross-program cap is enforced in BURN’s handler by reading SEAL’s list and bounding it with `MAX_RESERVE_MINTS`.

No sizing defect found in BURN’s config allocation.

---

## R8 — comments claiming controls that do not exist

### R8-1 HIGH — BURN `burn_vault` doc still says the Bank “must SCAN THE PDA BEFORE IT SIGNS”
Exact construct in `programs/cbob-vault-burn/src/lib.rs`:
```rust
/// Destroy a vault, and with it release everything it held. Owner AND Bank must
/// sign — the Bank because this is the one instruction that can permanently
/// remove value, so it must SCAN THE PDA BEFORE IT SIGNS and alarm on every call.
```

There is no Bank co-signing tool in the repository. Nothing scans before signing because nothing signs.

What a reader gains: a false belief that a pre-signature control exists.

Evidence:
- Grep for `SCAN THE PDA BEFORE IT SIGNS` in BURN.
- Grep the repository for a Bank signing tool; absent.

Fix:
- Rewrite to say: “The Bank must co-sign on-chain. No Bank co-signing tool exists in this repository; scanning before signature is currently a human procedure.”

---

### R8-2 HIGH — BURN header still says the completeness gap is “covered by the Bank’s co-signature”
Exact construct in BURN header:
```rust
//! CANNOT prove: completeness. ...
//! That gap is covered by the Bank's co-signature
//! — a Solana signature covers the whole transaction, so the Bank sees every
//! instruction — plus the off-chain scanner...
```

The same header elsewhere says no co-signing tool exists. This paragraph still claims coverage by a control that does not run.

Evidence:
- The phrase “covered by the Bank's co-signature” remains in BURN.
- SPEC says there is no Bank co-signing tool.

Fix:
- Replace “covered by” with “intended to be covered by a future Bank co-signing tool; today it is detected post-hoc, not prevented”.

---

### R8-3 MEDIUM — SEAL `Config.reserve_mints` comment still says the undeclared-token gap is covered by Bank co-signature
Exact construct in SEAL:
```rust
/// Unknown airdropped tokens still cannot be enumerated by any program — that gap is covered by
/// the Bank co-signature and the off-chain scanner, stated plainly rather than papered over.
```

Again, no co-signing tool exists.

Fix:
- State that the gap is detected by off-chain reconcile when it is detected, and not prevented today.

---

### R8-4 MEDIUM — `detectApprovals` comment describes a re-seal hazard that no longer exists
Exact construct in `bank/detectors.mjs`:
```js
 * Why it matters: a delegate approved during a legitimate thaw SURVIVES the
 * re-seal, and the Token program will honour it later...
```

v5 has no re-seal. A thaw must end in burn. The delegate hazard is now different: a delegate can cause burn refusal or indicate malicious pre-burn activity, but it cannot survive a re-seal because there is no re-seal.

Fix:
- Update the comment to v5 semantics.

---

### R8-5 LOW — SPEC and report text overclaim “no nested vaults”
Exact constructs:
- Alarm all-clear:
  `no approvals, no unexpected PDA token accounts, no nested vaults...`
- `detectNestedVaults` only sees CBOB vaults owned by CBOB vault PDAs.
- Foreign Core assets nested in vaults are not detected.

Fix:
- Say “no nested CBOB vaults” and list foreign nested Core assets in the NOT CHECKED section.

---

### R8-6 LOW — SPEC assertion counts are stale
Exact constructs:
- SPEC says `bank/selftest.mjs` has 69 assertions.
- SPEC says runner has 178 assertions, 93 detector, 14 allocation.
- Current floors/counts are 264, 221, 17.

Fix:
- Update SPEC or generate these numbers from the runner.

---

## Five files no auditor had seen

### bank/anchor.mjs

#### FILE-1 LOW — `pinnedAccountData` validates discriminator/version but not the minimum length required by callers
Exact construct:
```js
if (acc.data.length < 9) throw ...
return acc.data
```
Callers such as `revenue.mjs` read offsets up to at least 313 and in some cases 481. A truncated account with correct discriminator and version would pass `pinnedAccountData` and then throw a RangeError in the caller.

This is fail-loud, not silent, but it converts a layout fault into an uncontrolled crash rather than a named refusal.

Evidence:
- Construct a fake account with correct disc/version but length 20.
- `pinnedAccountData` returns data; subsequent offset read throws RangeError.

Fix:
- Add `minLength` to `pinnedAccountData` options.
- Callers should pass the highest offset + width they will read.

---

### scripts/validate-core-gate.sh

#### FILE-2 MEDIUM — The validation script is not itself a gate: it can print failure text and still exit 0
Exact construct:
- The script prints `!!! FALSE PASS` or `!!! FALSE FAIL` but never sets a nonzero exit code based on those outcomes.
- It uses `CACHE=/tmp/cbob-vault-test`, unlike `run-tests.sh`, which defaults to `/opt/cbob-vaults/.cache`.
- It does not verify the pinned Core sha256.

What a user gains: false confidence from a script that “ran” even when its arms fail.

Evidence:
- Run the script with a tampered expected Core. It prints `!!! FALSE PASS` but `echo $?` is 0.
- Run on a fresh machine without `/tmp/cbob-vault-test/core-mainnet.so`; behavior is undefined.

Fix:
- Track failures and `exit 1` if any arm misbehaves.
- Use the same `CBOB_CACHE` default as `run-tests.sh`.
- Verify the pinned sha256 before testing.

---

### tests/initauth.test.ts

#### FILE-3 MEDIUM — SEAL’s “ACCEPTS by reaching NoReserveMints” can become a false pass if the authority check is moved again
Exact construct:
```ts
const REACHED_PAST: Partial<Record<keyof typeof PROG, RegExp>> = {
  seal: /NoReserveMints|TooManyReserveMints|ReserveMintNotClassicSpl/,
}
```
The probe treats these SEAL errors as proof the authority check passed. That is only true if the authority check is first. If a future edit moves reserve checks above the authority check, a mainnet build that wrongly trusts the test key could still reject with `NoReserveMints` and be reported as ACCEPTS.

Evidence:
- Temporarily move `require_keys_eq!(ctx.accounts.admin.key(), INIT_AUTHORITY, ...)` below `require!(!reserve_mints.is_empty(), ...)`.
- The probe will report ACCEPTS by reaching `NoReserveMints` even for the wrong key.

Fix:
- Make the SEAL probe create a real classic SPL mint and pass a non-empty reserve list, so the only acceptable outcomes are real success or `NotTheInitAuthority`.
- Or add a source-order assertion in `build-mainnet.sh` that the authority check is the first statement in SEAL `initialize`.

---

### tests/probe-round5.test.ts

#### FILE-4 MEDIUM — This probe is stale and cannot run against the current programs
Exact constructs:
- It calls MINT `initialize` with only five pubkeys:
  ```ts
  Buffer.concat([d('initialize'), COLL, bank, gov, treasury])
  ```
  Current MINT `initialize` expects many more arguments, including `bank_treasury`, `swap_operator`, sweep bounds, and timelock.
- It calls `mint_vault` with only name and uri:
  ```ts
  Buffer.concat([d('mint_vault'), str('CBOBTC Vault'), str('https://...')])
  ```
  Current `mint_vault` expects `max_price_lamports` and `attributes`.

What a reader gains: if this file is cited as evidence for “born frozen” or delegate layout, it is evidence about an old program, not the current one.

Evidence:
- Run `npx tsx tests/probe-round5.test.ts` against the current validator deployment. The initialize/mint calls fail deserialization or account constraints before testing the intended properties.

Fix:
- Delete it, or update it to current ABI and wire it into the runner if it still adjudicates live facts.

---

### tests/probe-round5b.test.ts

#### FILE-5 LOW — Useful measurements, but not wired to any gate
This file appears to measure:
- Core `BurnV1` does not sweep the asset-signer PDA.
- Token-2022 ATA length is >165.
- T22 ATA creation for a classic mint is rejected.

It is not run by `scripts/run-tests.sh`. Its measurements can rot silently if Core, ATA, or Token-2022 behavior changes.

Fix:
- Either incorporate it into the certification runner where a validator with real Core exists, or archive it with a note that it is manual evidence only.

---

## Challenges to the Round 13 verdict

### VERDICT-1 MEDIUM — The rejected “BurnV1 closes the asset account” finding is disproven for one re-mint path, not for all Core states
The measurement in 9.12/9.13 is sound as far as it goes:
- The asset account survives.
- It remains Core-owned.
- `mint_vault` re-mint at the same address fails because System program refuses to create over a non-system account.

But it does not prove every possible tombstone-reuse path:
- It tests re-mint through `mint_vault`, which invokes Core `CreateV2` with the MINT PDA as collection update authority.
- It does not test direct Core `CreateV1`/`CreateV2` outside `mint_vault`.
- It does not test whether any Core instruction can reinitialize, close, or transfer lamports from a `Key::Uninitialized` tombstone.
- It does not bind future Core upgrades. The drift watch detects after the fact.

Evidence that would strengthen the rejection:
- Add a probe that directly calls Core create instructions over the burned asset address with the original keypair.
- Add probes for Core update/transfer/burn against the tombstone to confirm they fail.
- Record the exact Core commit/hash the measurement was made against.

Fix:
- Extend 9.12/9.13 to direct Core calls, not only `mint_vault`.
- State in SPEC that the tombstone guarantee is a Core behavior pinned by hash, not a local invariant.

---

### VERDICT-2 LOW — The Token-2022 derivation is unreachable only under current ATA program semantics
The rejection is mostly sound:
- For a classic SPL mint, the ATA program refuses to create a Token-2022 ATA because the mint owner does not match the token program.
- The derived T22 ATA is off-curve, so no raw account can be created there except by the ATA program.

Residual assumptions:
- This depends on ATA program behavior, which is not in the drift watch.
- If the ATA program or Token-2022 migration semantics change, the “unreachable” derivation may become reachable.
- The dead derivation still costs transaction capacity today.

Fix:
- The cheapest capacity repair is still to remove the T22 declarations from `burn_vault` after a deliberate measurement. The verdict carries this; it should be prioritized because the byte ceiling is already tight.

---

### VERDICT-3 — Accepted fix `MAX_RESERVE_MINTS=3` is challenged by R2-1/R2-2
The accepted fix may be directionally right but is not proven by the current harness. If signed/worst-case serialization exceeds 1232 for three mints, the fix is wrong or incomplete. See R2-1 and R2-2.

---

### VERDICT-4 — Accepted fix `correlateBurns` is challenged by R1-1/R1-2/R1-3
The correlation idea is reasonable, but the implementation is quieter than the on-chain rule and noisier than claimed in one lag ordering. See R1.

---

### VERDICT-5 — Accepted fix `detectNestedVaults` is challenged by R3-1
It detects CBOB vault nesting but falsely implies foreign Core nesting is covered elsewhere.

---

### VERDICT-6 — Accepted fix Core drift watch is challenged by R5-1/R5-2
The watch exists, but the hash slice and sentinel can leave holes.

---

### VERDICT-7 — Accepted fix `detectBankIsNotSignable` is challenged by R4-1
The detector catches the obvious multisig/PDA mistake but not wrapper/relayer misuse of an on-curve Bank key.

---

## Other findings outside the named targets

### OTHER-1 MEDIUM — `alarm.mjs readConfigs` reports version drift but continues parsing with possibly wrong offsets
Exact construct:
- `readConfigs` reads `version` as a field and puts it in the snapshot.
- It does not refuse offset reads when version is not the expected value.
- `bank/anchor.mjs` was created precisely to make money jobs refuse unknown versions.

What an accident gains:
- After a program layout upgrade, the alarm may emit a version drift but also misread bank, collection, reserves, or pending rotations from the new layout.
- Misreadings can produce false calm or false CRITICALs while the real drift is already known.

Evidence:
- Mock a config account with correct discriminator but `version = 2`.
- `readConfigs` still reads offsets and returns a snapshot.

Fix:
- In `readConfigs`, if `version` is not the pinned expected version, set `${key}._wrong_version` and skip offset reads for that config.
- Make the missing watched keys mechanism treat that as a loud failure, not calm.

---

### OTHER-2 MEDIUM — The entire watcher depends on one RPC/DAS source with no cross-check
Exact construct:
- `rpcUrl()` reads one `HELIUS_RPC_URL`.
- DAS vault listing, signature walks, account reads, and token balances all use that endpoint.

What an attacker/accident gains:
- A compromised, misconfigured, or partitioned RPC can return plausible calm data.
- The pipeline has many “read fails = alarm” guards, but not “read lies = alarm”.

Evidence:
- Point the alarm at a mock RPC that returns the previous baseline plus no new signatures. It will report calm.

Fix:
- Use at least two independent RPC sources for critical facts:
  - vault count/live/burnt from DAS,
  - program hashes,
  - reserve balances for activated vaults.
- Alert on disagreement, not only on failure.

---

### OTHER-3 LOW — `detectBankIsNotSignable` does not inspect pending Bank rotations
Exact construct:
- It checks current `seal.bank`, `burn.bank`, `mint.bank`.
- It does not check `seal.pending_bank`, `burn.pending_bank`, `mint.pending_bank`.

Pending rotations already raise `rotation_armed` CRITICAL, so this is not silent. But the specific “this pending Bank will break redemption” reason is not stated until after apply.

Fix:
- Also check pending banks and include “armed off-curve bank” in the finding detail.

---

### OTHER-4 LOW — `detectIndexShortfall` can be triggered by DAS treating burned tombstones inconsistently
If DAS ever stops counting burned tombstones as burnt or live, `live + burnt != minted_total` fires CRITICAL. That is fail-safe. But the failure message may be indistinguishable from a real index attack.

Fix:
- Add a separate diagnostic for “burnt count changed unexpectedly” versus “total unique count mismatch”, using prior burnt count state.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that thirteen rounds of AI audit structurally cannot?

1. **Create accountable human operations, not more code review.**
   AI can find defects, but it cannot own keys, be paged at 03:00, make an emergency decision, or be legally/socially accountable. Before real Bitcoin is held:
   - Name a human incident commander.
   - Write a key ceremony and key compromise runbook.
   - Define who can rotate Bank, admin, upgrade authorities, and under what out-of-band authentication.
   - Store recovery procedures offline.

2. **Run a separate, adversarial live environment.**
   Thirteen rounds have mostly audited text and local-validator measurements. The project needs a standing red-team environment:
   - Clone mainnet state where possible.
   - Use dust real cbBTC or wrapped equivalents.
   - Attempt RPC lying, DAS lag, signature-walk gaps, wrapper CPI laundering, failed-inner-instruction parsing, and transaction-size edge cases.
   - Treat every detector silence in that environment as a defect.

3. **Build an independent watcher with a different codebase and different data sources.**
   The current alarm is sophisticated but monolithic. A second watcher, written separately, using a different RPC/indexer, and checking only the top invariants, can catch systemic blind spots:
   - minted_total vs DAS count.
   - Core program hash.
   - Bank key on-curve.
   - Reserve balances falling.
   - Any burn without a paired open.
   This watcher should not share detectors, state files, or RPC configuration.

4. **Make the redemption client part of the certified system before mainnet value.**
   The on-chain programs now assume a transaction shape that no repository code constructs. The measurement harness is not a client. A canonical redemption client must exist and be tested for:
   - top-level instruction order,
   - signature set,
   - destination ATA precreation or creation,
   - compute budget,
   - versioned transaction support if needed,
   - refusal to sign unless pre-scan passes.
   Until that exists, “Bank co-signature” is a procedure, not a system.

5. **Introduce external failure reporting.**
   AI audits cannot be a public bug bounty or an insurance backstop, but the project should still create:
   - a public disclosure address,
   - a reward policy,
   - an emergency pause/communication channel,
   - and, if possible, insurance or capital reserve for watcher failure.

6. **Pin and reproduce artifacts outside the author’s machine.**
   `build-mainnet.sh` is careful, but the final bridge is still “rebuild from commit and compare sha256”. Before real value:
   - publish reproducible build instructions,
   - have at least one independent party reproduce the `.so` hashes,
   - store the hashes in more than one location,
   - require multi-party signature for deployment.

7. **Accept that AI certification is probabilistic, not exhaustive.**
   The process should state this in SPEC. Thirteen rounds have found real defects and also produced wrong CRITICALs. The correct operational posture is not “the code is proven safe”; it is “the code is continuously measured, the watchers are redundant, and the blast radius is bounded until humans and independent systems take over the remaining risk.”