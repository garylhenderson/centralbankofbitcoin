# R1 — `correlateBurns`

No demonstrated laundering path was found from a successful bare Core burn into an INFO finding.

A successful `burn_vault` finding is generated only from a successfully recorded transaction (the signature loop skips `s.err` transactions), and a successful `burn_vault` must have passed the on-chain paired-open check. A failed `burn_vault` cannot create the INFO correlation because the entire transaction is rolled back and the scanner skips it. A `burn_vault` for another asset cannot correlate because correlation keys on the asset address.

The signature/DAS lag direction is also conservative: if DAS sees a burn before the signature walk sees the corresponding `burn_vault`, `vault_burned` remains CRITICAL.

There is nevertheless one semantic limitation: the correlation is “a valid program burn was observed this pass,” not “the specific DAS transition was observed in that same transaction.” For a non-reusable asset address this does not currently create an apparent laundering construction, but the wording should not claim transaction identity.

**Fix:** Change the INFO wording from “was REDEEMED” to “a matching successful `burn_vault` was observed this pass; this is consistent with redemption.” Preserve transaction signatures in the correlation data and correlate by `(asset, signature)` where possible.

# R2 — `MAX_RESERVE_MINTS`

## MEDIUM — The packet-size harness does not build the universal customer redemption transaction

**Exact construct:** `tests/3prog.test.ts`, `sizeFor()` in 9.14:

```ts
const dst=getAssociatedTokenAddressSync(m,alice.publicKey,true)
return [createTransferInstruction(src,dst,...),
        createCloseAccountInstruction(src,...)]
```

The harness derives each recipient ATA but does not include a `createAssociatedTokenAccountIdempotentInstruction` for it.

**Impact:** The reported 3-mint ceiling applies only when the redeemer already has all three destination ATAs. For a first-time customer holding cbBTC but not `$GARY` and `$GIRAFFISH`, a redemption client either:

1. must make preparatory ATA-creation transactions before redemption, or
2. must put up to two ATA-create instructions into the redemption transaction.

The latter consumes bytes, account keys, and compute units that 9.14 does not measure. Therefore “THREE IS THE MAXIMUM” is not established for a normal first-time redeemer in one transaction.

This is not necessarily a permanent vault stranding issue: the customer can pre-create destination ATAs before redemption without unsealing the vault. But it makes the claimed measured ceiling too high for the stated all-in-one customer flow and creates an untested operational prerequisite.

**Evidence if correct:** Build the 3-mint transaction with idempotent destination ATA creation for every reserve mint. Its serialized size will exceed the 1090-byte result and may cross 1232 bytes depending on account-key reuse. Execute it against the validator with an owner that has no pre-existing destination ATAs.

**Fix:**
- Define the supported flow explicitly: either require pre-created recipient ATAs as a documented client precondition, or measure and enforce the fully self-contained transaction.
- Add two tests:
  - 3-mint redemption where all destination ATAs already exist;
  - 3-mint redemption where none exist and all required ATA creates are included.
- Do not call 3 the unconditional maximum until both cases are measured.

## MEDIUM — The byte cap is being represented as a complete redemption ceiling while compute usage is unmeasured

**Exact construct:** The new `MAX_RESERVE_MINTS = 3` comments in SEAL and BURN state that three “is the maximum,” based exclusively on legacy transaction serialization length. Test 9.14 serializes but does not simulate or execute the constructed 3-mint redemption.

**Impact:** The redemption contains:
- SEAL’s Core `UpdatePluginV1` CPI;
- a Core `ExecuteV1` containing six SPL instructions for three mints;
- three transfers;
- three closes;
- BURN’s raw-account checks over six declared addresses;
- Core `BurnV1`.

The transaction can fit in 1232 bytes and still exceed the default compute limit, or require a compute-budget instruction that itself consumes packet budget. If that happens for the actual three-reserve configuration, `MAX_RESERVE_MINTS = 3` still creates a redemption denial of service.

**Evidence if correct:** Simulate and send the exact 3-mint transaction against the validator with:
- all reserve accounts funded;
- every reserve swept and closed;
- actual recent blockhash;
- full signatures;
- no pre-existing compute budget instruction;
- then with the minimal required `ComputeBudgetProgram.setComputeUnitLimit` instruction.

Record `unitsConsumed`, transaction size, and landing result.

**Fix:** Make 9.14 an execution test, not a serialization-only test. Establish both:
- legacy packet headroom after any required compute-budget instruction; and
- compute-unit headroom below the cluster limit.

Do not raise the cap or describe the bound as measured until both constraints are measured.

## LOW — The versioned-transaction/ALT statement is incomplete

The comments say a fourth reserve “requires a versioned transaction with an address lookup table.” An ALT can reduce serialized account-key bytes, but it does not remove:
- instruction data;
- instruction account-index bytes;
- signatures;
- compute consumption;
- the requirement that the client construct, fund, extend, activate, and reference the ALT.

No supplied code builds or manages an ALT. Thus an ALT is not a present fallback; it is a future protocol/client migration.

**Fix:** State that a fourth mint is unsupported until an ALT lifecycle, v0 redemption builder, packet-size test, and execution/CU test exist.

# R3 — `detectNestedVaults`

No false-positive construction was established from the provided detector alone. Including burnt hosts is correct: if an inner vault is owned by the signer PDA of a burnt host, it is already unrecoverable, and excluding the host would hide the worst state.

The foreign-Core-asset limitation is honestly stated in the detector and SPEC. It remains severe: a foreign Core asset can be deposited into a vault and destroyed/orphaned by redemption without this detector seeing it. This is already disclosed as a scope limit, not a new finding.

One operational caveat remains: this detector trusts DAS `ownership.owner`. It must not be described as an on-chain proof. An index lag or incomplete ownership field produces either delay or silence. The current code treats `owner: null` as quiet.

**Fix:** Add a periodic sample or pre-sign direct account read for CBOB vault ownership. For alerting, report missing ownership metadata as a HIGH data-quality fault rather than treating it as a healthy vault.

# R4 — `detectBankIsNotSignable`

The rejection of the proposed `admin` extension is technically correct for the listed instructions.

`SEAL::update_config`, `SEAL::cancel_pending`, `BURN::update_config`, `BURN::cancel_pending`, `MINT::update_wiring`, `MINT::set_paused`, and `GOV::update_gov_config` do not perform instruction-sysvar pairing checks. A Squads vault may invoke these as CPI and satisfy Anchor’s `Signer` constraint through the calling program’s signer propagation. No admin instruction identified here requires the admin’s call to be top-level.

The detector’s stated limitation is real: an on-curve public key operated only through a smart-wallet wrapper or relayer has the same functional failure on the redemption path but looks valid to `isOnCurve`.

**Fix:** Do not treat the curve check as a sufficient signability check. Add an operational acceptance test whenever any Bank rotation is proposed: construct and simulate a real top-level `open + sweep + burn` transaction signed by the configured Bank key. This checks the property that matters.

# R5 — Core drift watch

## LOW — ProgramData ELF hashing uses a fixed offset that is wrong when the upgrade authority is absent

**Exact construct:** `bank/alarm.mjs`:

```js
const hasAuth = acc.data[12] === 1
snap[`prog.${name}.hash`] =
  createHash('sha256').update(acc.data.subarray(45)).digest('hex').slice(0, 32)
```

The ProgramData header is:

- 4 bytes state tag;
- 8 bytes deployment slot;
- 1 byte `Option<Pubkey>` tag;
- 32-byte pubkey only when the option is `Some`.

When `hasAuth === false`, ELF bytes begin at offset 13, not 45. The code will omit the first 32 bytes of the program image.

**Impact:** The Core hash is not actually a hash of all executable bytes after Core becomes immutable. It is also evidence that the layout comment “then the ELF” is false for `None`.

This does not create an immediate mutable-Core bypass: an immutable program cannot subsequently be upgraded through the normal loader. But a drift monitor should not silently hash the wrong data, especially where the system claims it watches Core behavior.

**Evidence if correct:** Obtain or construct a ProgramData account with `Option<Pubkey>::None`; compare:
- `sha256(data.subarray(13))`
- `sha256(data.subarray(45))`.

They differ, and the latter omits executable bytes.

**Fix:**

```js
const elfOffset = acc.data[12] === 1 ? 45 : 13
const elf = acc.data.subarray(elfOffset)
```

Also validate before parsing:
- `acc.owner.equals(BPF_LOADER_UPGRADEABLE)`;
- minimum header length;
- ProgramData state tag;
- that the program account itself points to the derived ProgramData account.

# R6 — off-chain assertion floors

The wrapper floor helper correctly fails if the expected summary line is absent and correctly rejects a count below the configured minimum. It does not prove that the printed count corresponds to executed assertions.

A developer can delete assertions and leave or forge a line matching:

```text
221/221 detector assertions as predicted
```

The shell wrapper will accept it. This is not a runtime attacker path; it is a source-integrity limitation. The same applies to all self-reported assertion-count schemes.

**Fix:** Emit assertion counts from a shared test runner rather than ad hoc test-file strings. At minimum:
- make each assertion increment an exported counter;
- have the runner calculate and print the final count;
- have the test process fail if actual count differs from a hardcoded expected count;
- hash or independently review the test runner as part of release provenance.

# R7 — account sizing after `MAX_RESERVE_MINTS = 3`

The supplied SEAL allocation expression remains sufficient after the cap reduction. Reducing a bounded vector from 8 to 3 cannot underallocate the current layout. BURN’s config does not store the reserve vector and its allocation is unaffected.

No sizing defect was established from the shown formulas.

# R8 — comments and specification claims

## MEDIUM — `SPEC.md` still materially contradicts implementation on sweep authorization and wiring authority

**Exact constructs:**

`SPEC.md` says:

> “`sweep_sol_for_swap(amount)` — **the swap operator SIGNS**”

This is correct.

But later, in the Revenue table and surrounding discussion, it says:

> “`sweep_sol_for_swap` … **permissionless**”

and:

> “The sweep is bounded IN THE PROGRAM. `sweep_sol_for_swap` is permissionless…”

That is false. `SweepSolForSwap` declares:

```rust
pub swap_operator: Signer<'info>
```

and the handler requires:

```rust
require_keys_eq!(ctx.accounts.swap_operator.key(), cfg.swap_operator, ...)
```

The spec also says `update_wiring` changes including `swap_operator` “additionally requires the governance signature.” The implementation does not include `swap_operator.is_some()` in `needs_governance`; it arms an operator rotation under admin authority subject to timelock.

**Impact:** This is not cosmetic. It changes the documented threat model:
- operators may believe outsiders can trigger sweeps when they cannot;
- reviewers may believe governance approval is required for an operator rotation when it is not;
- incident response can be delayed or performed under the wrong approval assumptions.

**Evidence if correct:** Invoke `sweep_sol_for_swap` without `swap_operator` as signer: Anchor rejects it. Invoke `update_wiring(swap_operator: Some(...))` with admin only: the implementation arms the rotation without a governance signer.

**Fix:** Correct all duplicated operational descriptions in SPEC. Add a CI grep/assertion that rejects the words “permissionless” near `sweep_sol_for_swap` unless explicitly qualified as obsolete historical text.

## LOW — MINT comments still describe deleted redemption machinery as live

**Exact constructs:** `programs/cbob-vault-mint/src/lib.rs` still contains:

```rust
/// Provenance stamped at creation. Bounded so the Attributes plugin stays within
/// what SEAL's `mark_opened` is willing to parse and rewrite ...
```

and:

```rust
/// SEAL owns this key and rewrites it on every close; MINT must never set it.
```

There is no `mark_opened` and no `close_redemption` in v5. The matching `ReservedAttribute` error text also describes a redemption stamp that no longer exists.

This is already disclosed as known dead functionality, but it remains a wrong-comment defect. It will mislead the next change to attributes.

**Fix:** Either remove the obsolete reservation/delegation in a separately reviewed migration, or change the comments and error messages now to say explicitly that these are retained compatibility/dead-policy artifacts pending removal.

# Never-audited file: `bank/anchor.mjs`

No immediate parsing flaw was found in `pinnedAccountData`. It checks:
- account owner;
- Anchor account discriminator;
- version byte;
- minimum length before reading bytes.

The `null` return is intentional and callers generally handle it.

The main residual issue is architectural: the helper verifies only a caller-supplied expected version and struct name. It cannot establish that the caller’s subsequent offsets are valid for that version. That requires offset-specific tests in each consumer. `revenue.mjs` and `distribute.mjs` should have tests that feed valid pinned data with deliberately shifted fields and prove they refuse or read expected values.

# Never-audited file: `scripts/validate-core-gate.sh`

## HIGH — The validation script reports gate failure but exits successfully

**Exact construct:**

```bash
gate "$CACHE/core-mainnet.so" && echo "!!! FALSE PASS — gate is useless" || echo "correct"
...
gate "$CACHE/g-tampered.so" && echo "!!! FALSE PASS — gate is useless" || echo "correct"
...
gate "$CACHE/core-mainnet.so" && echo "correct" || echo "!!! FALSE FAIL — gate rejects a good validator"
kill_v
```

The script has no `set -e`, and every failed or unexpectedly successful gate is converted into `echo`. The final `kill_v` normally succeeds, so the script exits zero even after printing `!!! FALSE PASS`.

**Impact:** CI or an operator can run this script, receive exit status 0, and treat a broken Core gate as validated. This defeats the intended “proven in both directions” certification of the test environment.

**Evidence if correct:** Replace `gate` temporarily with `return 0` for ARM 1 or ARM 2. The script prints `!!! FALSE PASS — gate is useless`; then `echo $?` returns `0`.

**Fix:**

```bash
set -euo pipefail

must_fail() {
  if "$@"; then
    echo "FALSE PASS: expected failure: $*" >&2
    exit 1
  fi
}

must_pass() {
  if ! "$@"; then
    echo "FALSE FAIL: expected success: $*" >&2
    exit 1
  fi
}
```

Use `must_fail gate ...` for arms 1 and 2 and `must_pass gate ...` for arm 3.

## MEDIUM — The script does not validate the full production Core gate

It calls its comparison input `$1` “the EXACT logic from `run-tests.sh`,” but it omits the most important production-side precondition: the pinned SHA-256 validation of `core-mainnet.so`. It trusts `/tmp/cbob-vault-test/core-mainnet.so`.

**Impact:** It can prove that `program dump + cmp` distinguishes two arbitrary binaries, but not that the expected binary is the pinned mainnet Core artifact used by the real runner.

**Fix:** Use the same non-world-writable cache and pinned hash check as `run-tests.sh`, or source a single shared gate implementation from both scripts.

# Never-audited file: `tests/initauth.test.ts`

No concrete wrong-reason path was established in the current shown initialize layouts. The probe uses correctly shaped current arguments for MINT, BURN, and GOV. SEAL’s empty reserve list deliberately reaches a later handler error only after the authority check.

One limitation remains: “mainnet build rejects the localnet key” proves only that it does not contain the localnet authority. It does not positively prove that the binary contains the intended Squads authority. The build script acknowledges this limitation.

# Never-audited file: `tests/probe-round5.test.ts`

## MEDIUM — The round-5 probe is stale and no longer tests the claims it documents

**Exact constructs:**

The probe still serializes the old MINT initializer:

```ts
data: Buffer.concat([
  d('initialize'),
  COLL.toBuffer(),
  bank.publicKey.toBuffer(),
  gov.publicKey.toBuffer(),
  treasury.publicKey.toBuffer()
])
```

The current MINT `initialize` requires additional arguments for:
- `bank_treasury`;
- `swap_operator`;
- `sol_reserve_lamports`;
- `max_supply`;
- `max_sweep_lamports`;
- `sweep_cooldown_secs`;
- `governance_timelock_secs`.

It also constructs an obsolete `mint_vault` payload without `max_price_lamports` and the attributes vector, and passes the owner as non-signer.

**Impact:** This probe cannot currently establish that a vault is born frozen. It will fail before the tested handler path due to instruction deserialization, absent configuration, or signer constraints. If anyone relies on it as a measured adjudication artifact, that reliance is false.

**Evidence if correct:** Run:

```bash
npx tsx tests/probe-round5.test.ts
```

The MINT initialize attempt cannot deserialize under the current ABI, and subsequent actions cannot establish the stated D5 properties.

**Fix:** Either delete the stale probe and point to the maintained end-to-end assertions 2.3a and 3.7, or update it to the current ABI and add it to `scripts/run-tests.sh`. A test not executed by the certification path should not be called a settled measurement.

# Never-audited file: `tests/probe-round5b.test.ts`

No new flaw was established in the shown probe. Its Core Burn and Token-2022 ATA tests are independently formed and do not depend on the stale MINT initializer ABI.

It is still not part of `run-tests.sh`; therefore its results are not continuously certified.

# Verdict challenges

## Rejected tombstone/re-mint finding

The measurement is sound for the tested cloned Core version:
- the asset account remains Core-owned;
- it contains the `Uninitialized` key byte;
- it retains lamports;
- a System-owned account creation at the same address fails because the account already exists.

The conclusion is valid only as a version-pinned Core behavior. It does not establish a permanent protocol invariant across future Core upgrades. The newly added Core byte watch is detection after the fact, not prevention. A Core upgrade could alter tombstone handling before an operator reacts.

No current reclaimable tombstone state was shown. The claim should be scoped to “under pinned Core hash X,” not “never exists again” without qualification.

## Rejected Token-2022 derivation finding

The “unreachable” conclusion is substantially supported:
- the ATA program rejects use of Token-2022 for a classic SPL mint;
- the Token-2022-derived ATA is an off-curve PDA;
- no external signer can create a raw account at that address;
- another program cannot sign for a PDA under the ATA program’s seeds.

The capacity impact is not half under the measured construction. It remains unnecessary transaction baggage and should be removed only with a focused proof that the remaining classic ATA check retains all intended emptiness properties.

# Other material issue

## HIGH — `SPEC.md` and comments cannot be treated as an authoritative source of operational truth

The repository repeatedly says SPEC is “written FROM the implementation,” but it contains stale version counts, stale human-audit promises, contradictory sweep authorization statements, and stale attribute/redemption descriptions. This is not merely editorial debt: the project explicitly uses comments and SPEC as compensating controls for actions not enforced on-chain.

**Fix:** Generate a machine-checked operational reference from source constants and instruction schemas. For every statement that controls an operator action—who signs, whether a call is top-level, whether a call is permissionless, and which authority approves a rotation—add a test that compares the documentation’s declared property to the actual account constraints and handler logic.

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that thirteen rounds of AI audit structurally cannot?

1. **Do not custody customer cbBTC while the certification mechanism is self-referential.** AI-generated findings, AI-generated repairs, and self-authored tests cannot provide an independent assurance boundary.

2. **Separate authorship and verification infrastructure.** Run builds, validator tests, deployment verification, and alarm monitoring from independently administered hosts, keys, repositories, and CI identities. The same host/user currently owns code, state, notification paths, ledgers, and money-moving keys.

3. **Require reproducible release artifacts and independent binary reproduction.** Publish source commit, compiler/toolchain digest, program hashes, Core hash, build logs, and deterministic rebuild instructions. Have at least two independent operators reproduce the deployment hashes before custody.

4. **Use staged value limits.** Start with no customer assets, then capped test value, then explicitly bounded exposure. A system with unresolved operational controls should not jump directly to meaningful Bitcoin custody.

5. **Build the missing Bank co-signing client before enabling redemption.** It must construct, simulate, inspect, and sign the exact final transaction—not an earlier draft—and it must surface unverifiable conditions such as post-scan third-party airdrops.

6. **Replace the file lock before any distribution or revenue job is live.** The known `unlink` race is a money-moving concurrency defect. Use kernel-backed `flock`/`fcntl` locking on an open descriptor, with a documented recovery procedure.

7. **Treat monitoring as detection only.** Drift alerts, DAS scans, and 30-minute reconciliation cannot prevent a transaction that already landed. Emergency pauses, key rotation plans, and customer communications must be rehearsed as operational incidents.

8. **Commission adversarial live-fire exercises even if no traditional audit firm is used.** This means independent operators attempting to break deployment gates, alter cache inputs, poison state files, induce RPC inconsistencies, race money jobs, and exploit stale documentation. AI review of supplied source cannot establish resistance to a compromised environment or workflow.