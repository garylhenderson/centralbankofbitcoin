# Findings

## R1 — `correlateBurns` downgrades an incompletely proven destruction to INFO  
**Severity: HIGH**

### Exact construct

`bank/detectors.mjs`:

```js
if (f.kind === 'vault_burned' && f.asset && viaProgram.has(f.asset)) {
  out.push({ ...f, severity: S.INFO, ... })
}
```

The presence of a `burn_via_program` finding proves only that a successful `burn_vault` instruction was observed. It does **not** prove that all assets held by the asset-signer PDA were checked.

The on-chain burn proof remains explicitly incomplete:

- arbitrary SPL token accounts owned by the PDA cannot be enumerated on-chain;
- foreign Core assets are not checked by `detectNestedVaults`;
- `detectNestedVaults` only considers CBOB collection assets;
- DAS and `getTokenAccountsByOwner` are post-hoc and may lag.

Therefore a valid `burn_vault` can execute successfully while destroying an undeclared foreign Core asset or undeclared token account. The correlator then converts the corresponding `vault_burned` finding to INFO, despite the destruction being potentially irreversible.

### Impact

A human sees an INFO “normal redemption” and may not investigate a redemption that destroyed customer-held assets outside the deterministic reserve list.

This directly contradicts the comment:

> “Anything undeclared is still orphaned”

That is not an informational condition. It is potentially permanent customer-asset loss.

### Evidence if correct

Construct a transaction containing:

1. `open_for_redemption`;
2. a sweep of all declared reserve accounts;
3. `burn_vault` with only the canonical declared accounts;
4. an undeclared token account or foreign Core asset owned by the asset-signer PDA.

The transaction should succeed. The next alarm pass should produce:

- `burn_via_program` for the asset;
- `vault_burned` for the same asset;
- after correlation, only INFO for the burn;
- no same-pass CRITICAL for the undeclared foreign Core holding.

### Fix

Do not downgrade a burn merely because `burn_vault` ran. At minimum:

- keep `vault_burned` HIGH or CRITICAL until completeness has been independently established;
- distinguish “program burn observed” from “safe redemption verified”;
- downgrade only when all applicable off-chain completeness checks have completed successfully for that exact asset and transaction;
- include an explicit foreign-Core-asset scan, or state that every burn remains a destructive action requiring human review.

`burn_via_program` may be INFO as a route marker, but it must not suppress the destruction finding.

---

## R1 — The correlation is not transaction-scoped  
**Severity: MEDIUM**

### Exact construct

`correlateBurns` builds a set keyed only by asset:

```js
const viaProgram = new Set()
for (const f of findings)
  if (f.kind === 'burn_via_program' && f.asset)
    viaProgram.add(f.asset)
```

It does not require the `burn_via_program` and `vault_burned` findings to refer to the same transaction, slot, block time, or observation interval.

Today, an asset normally cannot be successfully burned twice, so this is not automatically exploitable for one immutable asset. However, the implementation’s stated invariant is stronger than the code: it claims to correlate a specific redemption transaction, while actually correlating arbitrary findings in one aggregate list.

This becomes unsafe if:

- the same asset identifier is reused after a Core behavior change;
- findings from multiple scan windows are merged;
- a stale or replayed finding is retained by a future pipeline change;
- the detector is reused for another asset lifecycle.

### Evidence if correct

Feed the correlator two findings for the same asset but different transaction metadata:

```js
[
  { kind: 'burn_via_program', asset: A, signature: 'old' },
  { kind: 'vault_burned', asset: A, signature: 'new' }
]
```

It downgrades the new destruction despite the program burn belonging to another observation.

### Fix

Carry and require transaction identity, slot/block time, or an explicit lifecycle correlation record. Do not correlate solely by asset string.

---

## R2 — The redemption-size harness does not prove the production worst case  
**Severity: HIGH**

### Exact construct

`tests/3prog.test.ts`, `sizeFor()` constructs:

```js
const inner = ms.flatMap(m => [
  transferInstruction(...),
  closeAccountInstruction(...)
])
...
const tx = new Transaction().add(
  ixOpen(...),
  ...sw,
  ixBurn(..., decl)
)
```

The harness omits at least the following possible production costs:

- creation of the owner’s destination ATAs if they do not already exist;
- any destination-account setup instructions used by the actual redemption client;
- the complete production signer/account arrangement;
- any production compute-budget instructions;
- the actual recent blockhash;
- any production wrapper, nonce, or fee-payer behavior.

It therefore proves only that **this particular manually constructed legacy transaction** serializes at the measured size.

The statement that it builds “the real transaction” is unsupported unless the production redemption builder is exactly this construction.

### Impact

The cap may be too high. A production redemption can fail serialization or compute limits even though the suite reports that three reserve mints fit. Since reserve additions are permanent, this can strand every existing vault.

### Evidence if correct

Build the transaction using the actual redemption client, with:

- every production reserve ATA;
- every sweep destination ATA in its worst state;
- all required account creations;
- actual signer set;
- actual blockhash;
- the same transaction version used in production.

If its serialized size exceeds 1232 bytes for three mints, the current cap is unsafe.

### Fix

Have one canonical redemption builder shared by production and the measurement harness. Measure:

- minimum and maximum account-existence cases;
- legacy and v0 forms;
- all required compute-budget instructions;
- serialized size;
- simulated compute units;
- actual landing on the target cluster.

Do not encode `MAX_RESERVE_MINTS` until the builder used in production has been measured.

---

## R2 — No compute-unit ceiling was measured  
**Severity: MEDIUM**

### Exact construct

The suite measures only:

```js
tx.serialize(...).length
```

No transaction is simulated with the production instruction set and no compute-unit consumption is recorded. The comments explicitly acknowledge this gap.

### Impact

A three-mint transaction can fit under 1232 bytes but exceed the default compute budget, particularly with:

- multiple Core `ExecuteV1` CPIs;
- ATA/token transfers and closes;
- Core plugin updates;
- burn validation loops;
- multiple reserve mints.

That creates the same operational result as an oversized packet: redemption becomes unavailable.

### Evidence if correct

Run `simulateTransaction` or the production client against the target validator and record `unitsConsumed` for:

- one, two, and three reserve mints;
- all accounts present;
- worst-case account setup;
- the actual production transaction.

A value over the configured/default budget, or insufficient headroom under realistic variation, confirms the issue.

### Fix

Measure CU as part of the cap test, add explicit compute-budget instructions if appropriate, and enforce a tested CU margin before increasing the reserve limit.

---

## R3 — `detectNestedVaults` is honest about its CBOB-only scope, but the operational consequence is understated  
**Severity: HIGH**

### Exact construct

The detector builds its host map from the collection listing:

```js
const owners = new Map()
for (const v of vaults) {
  const p = pdaOf(v.id)
  if (p) owners.set(p, v.id)
}
```

It can detect a CBOB vault whose owner is a CBOB vault PDA. It cannot detect a foreign Core asset held by that PDA.

The comments state this limitation, but the overall report still presents the nested-vault detector as the active control for the nesting hazard. The actual foreign-Core case remains completely invisible until after the outer burn, at which point the foreign asset may already be unrecoverable.

### Impact

A holder can transfer a foreign Core asset into a CBOB asset-signer PDA. A later authorized redemption of the outer CBOB vault can destroy the foreign asset without:

- `detectNestedVaults` reporting it;
- `burn_vault` being able to enumerate it;
- the signature scanner seeing the transfer.

This is a real customer-asset destruction path, not merely a documentation gap.

### Evidence if correct

On a validator:

1. create a Core asset outside the CBOB collection;
2. transfer it to a CBOB vault’s asset-signer PDA;
3. run the alarm’s collection listing and detector;
4. verify no nested finding is produced;
5. redeem and burn the outer vault without declaring the foreign asset.

### Fix

Either:

- prohibit redemption unless an external, trusted pre-sign scanner has enumerated all relevant Core holdings; or
- add a DAS owner query for every vault PDA and inspect all Core assets, not only assets in the CBOB collection.

The report should separately say: “CBOB nested assets checked; foreign Core holdings not checked.”

---

## R5 — Hashing ProgramData from byte 45 is wrong when upgrade authority is absent  
**Severity: MEDIUM**

### Exact construct

`bank/alarm.mjs` always computes:

```js
snap[`prog.${name}.hash`] =
  createHash('sha256')
    .update(acc.data.subarray(45))
    .digest(...)
```

The code correctly recognizes:

```js
const hasAuth = acc.data[12] === 1
```

but does not change the ELF offset when the upgrade authority is `None`.

For BPF Loader v3 ProgramData accounts:

- with `Some(authority)`, the ELF begins after the 32-byte authority payload, at offset 45;
- with `None`, the Option contains only its tag, so the ELF begins at offset 13.

### Impact

For an immutable program, the watcher hashes the wrong bytes:

- it omits the first 32 bytes of the ELF;
- it includes header/option bytes;
- a change confined to the first 32 ELF bytes can go undetected;
- comparisons between mutable and immutable states are not meaningful.

The sentinel for an absent ProgramData account does not address an existing ProgramData account whose authority is absent.

### Evidence if correct

Use an immutable upgradeable-loader program or revoke the upgrade authority, then verify:

```js
acc.data.subarray(13, 17) === ELF_MAGIC
```

The current implementation instead hashes from offset 45. Modify only bytes in the first 32 bytes of the ELF and confirm the recorded hash does not change.

### Fix

Parse the loader state rather than hardcoding one offset:

```js
const elfOffset = hasAuth ? 45 : 13
if (acc.data.readUInt32LE(0) !== PROGRAMDATA_VARIANT) throw ...
if (!acc.data.subarray(elfOffset, elfOffset + 4).equals(Buffer.from('\x7fELF'))) throw ...
```

Hash exactly the ELF payload for both authority states.

---

## R6 — The off-chain assertion floor is not a meaningful integrity guarantee  
**Severity: MEDIUM**

### Exact construct

`run-tests.sh` checks only:

```bash
floor ... "$DET_FLOOR"
floor ... "$ALLOC_FLOOR"
```

The helpers require a count above a fixed minimum, but do not require:

- the expected exact count;
- the expected assertion names;
- coverage of particular critical properties;
- a checksum or reviewed manifest of test cases.

The detector selftest itself prints the count only at the end. A future edit can delete critical assertions and replace them with duplicated trivial assertions while remaining above 221.

The allocation suite’s same weakness is explicitly present.

### Impact

The build can certify a materially weaker test suite. This is especially dangerous because the off-chain pipeline carries controls that are not enforced on-chain.

### Evidence if correct

Replace several critical detector tests with repeated assertions such as:

```js
t('quiet empty input', D.detectNestedVaults([], () => null).length, 0)
```

until the output still exceeds the floor. The gate remains green despite losing coverage of burn correlation, account poisoning, revenue reconciliation, or distribution failure.

### Fix

Use an exact expected count plus a versioned assertion manifest, or require named sentinel tests for every critical property. Better:

- split tests into independently named suites;
- assert exact counts per suite;
- hash the test files in CI;
- run mutation testing for detector logic;
- fail if a critical detector has no negative and positive case;
- execute tests in separate processes so one failure cannot suppress later assertions.

The floor is useful as a crash detector, but it is not proof against semantic test deletion.

---

## R8 — The stale “scan before signing” control remains in the BURN header  
**Severity: LOW**

### Exact construct

`programs/cbob-vault-burn/src/lib.rs` still says:

> “Owner AND Bank must sign — the Bank because this is the one instruction that can permanently remove value, so it must SCAN THE PDA BEFORE IT SIGNS and alarm on every call.”

The same file later correctly states that no co-signing tool exists. Those statements are inconsistent.

### Impact

An operator or integrator reading the instruction documentation can reasonably conclude that the Bank’s signature is backed by an implemented automated scan. It is not. This is precisely the documentation defect the repair was intended to eliminate.

### Evidence if correct

Search the repository for:

```text
SCAN THE PDA BEFORE IT SIGNS
```

The BURN source still contains the claim, while no file implements a Bank signing workflow.

### Fix

Change the comment to state:

- the Bank signature is structurally required by the program;
- no Bank signing/scanning tool exists;
- pre-sign review is presently manual;
- the on-chain program cannot prove enumeration completeness.

Also audit all comments for “must scan,” “will alarm,” and “covered by the Bank” language.

---

# Files never previously audited

## `scripts/validate-core-gate.sh` can report success even when its tests fail  
**Severity: HIGH**

### Exact construct

The script has no:

```bash
set -euo pipefail
```

Its expected-failure arms are written as:

```bash
gate "$CACHE/core-mainnet.so" && echo "!!! FALSE PASS — gate is useless" || echo "correct"
```

and similarly for the tampered and good cases.

If `gate` unexpectedly passes in ARM 1 or ARM 2, the script prints `FALSE PASS` but exits successfully because the `echo` succeeds. If ARM 3 fails, it prints `FALSE FAIL` but again exits successfully.

`boot` can also return failure, but callers do not enforce its status.

### Impact

The repository can certify that the Core gate was tested in both directions when:

- the “must fail” test actually passed;
- the “must pass” test actually failed;
- the validator failed to start;
- an old validator or stale environment was used.

This is a false-pass test harness around the certification gate itself.

### Evidence if correct

Modify `gate` to always return the wrong result in one arm, or make `boot` return failure. The script still exits 0 after printing a warning.

### Fix

Use strict shell mode and explicit assertions:

```bash
set -euo pipefail

expect_fail() {
  if "$@"; then
    echo "FALSE PASS" >&2
    exit 1
  fi
}

expect_pass() {
  "$@" || {
    echo "FALSE FAIL" >&2
    exit 1
  }
}
```

Also require `boot` success and verify that the expected validator process and ledger are the ones actually running.

---

## `validate-core-gate.sh` uses an attacker-writable `/tmp` cache  
**Severity: MEDIUM**

### Exact construct

```bash
CACHE=/tmp/cbob-vault-test
```

The production runner deliberately moved its cache out of `/tmp`, but the validation script did not.

### Impact

A local user can replace or race the expected Core artifacts and alter what the gate tests. Even if a fake artifact fails validator loading, this is still the wrong environment for certifying the exact gate on which production test claims depend.

### Evidence if correct

As another local user, replace:

```text
/tmp/cbob-vault-test/core-mainnet.so
```

between the script’s validation and boot steps, or pre-create the directory and expected files.

### Fix

Use the same protected cache path as `run-tests.sh`, verify ownership and permissions, and compare against the hardcoded trusted SHA-256 before every arm.

---

## `bank/anchor.mjs` does not validate that the account is actually ProgramData-compatible  
**Severity: LOW**

### Exact construct

`pinnedAccountData` validates owner, length, discriminator, and version for Anchor accounts, but the ProgramData reader in `alarm.mjs` has separate parsing logic that does not validate:

- loader state variant;
- ELF magic at the computed offset;
- whether the account is actually a ProgramData account.

A wrong or malformed account can still produce an upgrade-authority/hash snapshot if it happens to contain enough bytes.

### Impact

The watcher can baseline nonsense rather than refusing to operate. This is primarily a false-negative monitoring risk.

### Evidence if correct

Supply a loader-owned account with arbitrary data at the derived address in a test fixture and observe that the reader produces authority/hash values rather than rejecting the state.

### Fix

Centralize ProgramData parsing in a pinned helper and validate the loader enum, Option tag, computed ELF offset, and ELF magic before producing any watch values.

---

# Verdict challenges

## Burn tombstone conclusion is only valid for the tested Core version  
**Severity: MEDIUM**

The test evidence is sound for the cloned Core binary and the particular burn path exercised. It does not prove a permanent protocol invariant.

The conclusion “never exists again” depends on Core continuing to:

- preserve the asset account;
- leave it Core-owned;
- leave the `Key::Uninitialized` tombstone;
- reject `CreateV2` over that account;
- provide no future reclaim/reinitialization path.

A future Core upgrade could alter any of these behaviors. The new hash watcher detects such a change only after deployment and after the behavior may affect customers. It does not preserve the invariant.

The correct statement is:

> “The pinned Core version leaves an unreusable tombstone in the tested path. This is not an on-chain invariant guaranteed by this project.”

If address non-reuse is business-critical, use an independent permanent burned-address registry or an asset-generation scheme that does not depend on third-party Core burn semantics.

---

## The Token-2022 derivation is unreachable under the tested ATA rules, but the claim is conditional  
**Severity: LOW**

The measured conclusion is reasonable for:

- the canonical ATA program;
- a classic SPL mint;
- the tested Token-2022 ATA derivation;
- the current Token-2022 and ATA program behavior.

It is not a universal cryptographic impossibility. The project’s conclusion depends on the ATA program continuing to reject a mint whose owner is not the requested token program and on no alternative program being able to initialize the same PDA.

The operational issue remains real: the dead derivation consumes approximately 32 bytes per reserve mint and contributes to the transaction ceiling. It should be removed only after the emptiness proof is refactored and re-tested, but it should not be described as universally unreachable independent of program upgrades.

---

# Additional operational finding

## The production state still relies on a non-exclusive lock  
**Severity: HIGH — already known, but worse than stated**

The repository correctly documents that `bank/lock.mjs` retains a TOCTOU window between the final reread and `unlinkSync`. This is not merely theoretical for money-moving jobs.

A process can:

1. verify the stale token;
2. be descheduled;
3. another process break/create the lock;
4. the first process unlink the new lock;
5. both processes proceed or a third process enters.

The current selftest injects a race before the unlink and after the unlink, but cannot exercise the actual cross-process scheduling window. The test therefore proves the seams, not the filesystem behavior under real concurrency.

The fix should be treated as a release blocker: use `flock`/`fcntl` on an open descriptor, or a lock implementation with kernel-managed lifetime. Do not deploy the current JSON lock for distribution or revenue.

---

# What this project should do given that no human firm will ever see it

Thirteen rounds of AI review cannot provide the missing guarantees by simply adding another textual audit. The project needs an independent certification mechanism that is difficult for the implementation author—or an auditor model—to accidentally validate with self-consistent assumptions:

1. **Freeze the protocol and generate independent clients.**  
   The production transaction builders, test builders, and measurement harnesses must not share instruction-construction code.

2. **Use property-based and mutation testing.**  
   Automatically mutate:
   - pairing checks;
   - account indices;
   - reserve loops;
   - discriminator constants;
   - severity mappings;
   - watcher cursor/state handling;
   - transaction builders.  
   The suite must fail for each mutation.

3. **Make the watcher fail closed by default.**  
   No unverified burn should become INFO merely because a program path was observed. Unknown completeness must remain urgent.

4. **Eliminate self-authored ledgers as sources of truth.**  
   Reconcile distributions, swaps, splits, and operator activity from chain state and independently stored append-only records.

5. **Replace filesystem locks with kernel primitives.**

6. **Create a reproducible release artifact.**  
   Each release should contain:
   - source commit;
   - toolchain digest;
   - all program hashes;
   - Core hash;
   - exact test-file hashes;
   - exact assertion manifests;
   - measured packet and CU envelopes.

7. **Require two independent implementations of the critical paths.**  
   A second implementation should independently construct and simulate:
   - mint;
   - redemption;
   - burn;
   - revenue split;
   - distribution.

8. **Do not deploy real customer value until destructive chaos tests pass.**  
   Deliberately inject:
   - DAS omissions;
   - RPC lag;
   - stale cursors;
   - malformed accounts;
   - foreign Core holdings;
   - duplicate IDs;
   - failed confirmations;
   - concurrent runners;
   - changed ProgramData layouts;
   - Core upgrades.  

The current code has too many controls whose effectiveness depends on comments, self-authored state, or tests that share the same assumptions as the implementation. That is not a certification basis for real Bitcoin.