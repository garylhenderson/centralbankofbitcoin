# R1 — MINT/SEAL bank-key confinement

## No new bypass established in the supplied MINT confinement

The positional restriction closes the obvious discriminator-only exemption:

```rust
if is_mint {
    for (n, a) in ix.accounts.iter().enumerate() {
        require!(a.pubkey != bank || n == MINT_IX_BANK_IDX, ...)
    }
}
```

For a dispatched `mint_vault`, account 4 is `bank`; `payer` is account 5. Extra accounts do not let account 4 acquire `payer` semantics, and duplicate appearances of the Bank at any other position are rejected.

The added instructions account is at position 7, matches the changed test builders, and the Anchor address constraint pins its key to the instructions sysvar before the handler runs.

`seen_self` is also sufficient against the stated early-stop concern under normal Solana instructions-sysvar construction. Once the loop has successfully loaded the current instruction, later valid top-level instructions are stored contiguously; the next ordinary error is the end-of-list result. An attacker cannot insert a malformed “hole” into the runtime-created instructions sysvar.

The new constants independently check out:

- `sha256("global:mint_vault")[0..8]` = `[29, 76, 246, 26, 123, 202, 230, 234]`
- `MINT_IX_BANK_IDX = 4` matches `MintVault.bank`.

The fee payer limitation is accurately identified: the message fee payer is not necessarily present in any compiled instruction account list, so an instructions-sysvar walk cannot generally discover it.

## LOW — The new full-transaction walks have no execution-budget bound

**Construct**

Both programs now deserialize every top-level instruction and inspect its accounts:

```rust
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
    ...
    for (n, a) in ix.accounts.iter().enumerate() { ... }
}
```

This is bounded indirectly by Solana’s transaction-size limit, but the actual compute cost has not been measured. MINT performs this work before the expensive mint path, while SEAL performs it as part of redemption.

**Impact**

This is primarily a liveness and integration risk, not a theft. A transaction that fits the 1,232-byte limit may nevertheless exceed its compute budget after the new scans are added, particularly when combined with Core and token CPIs. The project currently knows redemption byte ceilings but not the corresponding CU ceilings.

**Evidence**

Run the maximum supported redemption and the largest practical multi-instruction mint transaction with compute-unit logging enabled. If this finding matters, the transaction logs will show materially increased `consumed X of Y compute units`, or failures without an increased compute limit.

Also compare:

1. plain mint;
2. mint plus the maximum number of small unrelated instructions;
3. three-reserve redemption;
4. those transactions with and without the new scans.

**Fix**

Establish measured CU ceilings in validator tests and production simulation. Add a regression threshold with explicit headroom. Do not merely add an arbitrary compute-budget instruction without first measuring the worst supported transaction.

---

# R2 — Distribution cadence and weights

## HIGH — Any existing vault owner can still halt all distributions by activating before its off-chain level exists

**Construct**

An activated vault without an own property in `LEVEL_WEIGHTS` aborts the entire allocation:

```js
const unlevelled = activated.filter(
  v => !Object.hasOwn(LEVEL_WEIGHTS, levels[v] ?? '')
)
if (unlevelled.length) {
  return { ...empty, refusal: true, skip: ... }
}
```

Activation is inferred from an independently fundable cbBTC balance. Level assignment is an off-chain file operation and is not coupled atomically to that balance transition.

**Impact**

A holder of any already-minted vault can fund its PDA to 21,000 sats before the operator creates its `levels.json` entry. Every activated holder then receives nothing until an operator repairs the register.

Failing closed is financially preferable to silently excluding the unlevelled vault, but that does not make the public liveness dependency acceptable. “Paying everyone else would be wrong” justifies the refusal branch; it does not justify allowing an ordinary customer state transition to trigger it.

**Evidence**

On a staging ledger:

1. leave one minted vault absent from `levels.json`;
2. fund its PDA from 20,999 to 21,000 sats;
3. run `distribute.mjs`;
4. observe `plan.refusal === true`, zero transfers, `finishedAt` recorded, and a `distribution_refused` finding.

That is the exact evidence of the availability attack.

**Fix**

Every minted vault must receive a committed level before it can ever become customer-accessible. At minimum:

- create the level record as part of the Bank-controlled mint workflow;
- refuse to co-sign or deliver the mint unless that durable record exists;
- continuously assert that every live minted vault—not merely every activated one—has a level.

The stronger repair is an independently verifiable level commitment tied to the asset address before mint delivery. That also addresses the already-open unverifiable-level limitation.

## MEDIUM — A manually paid `resolved` row does not reset the hold clock

**Construct**

`paymentState` treats a human resolution as settled:

```js
if (row.resolvedBy) return 'resolved'
```

But `holdDays` only recognizes:

```js
paymentState(r) === 'paid'
```

The surrounding comments explicitly give this example:

```js
resolvedBy: 'gary: ATA unfrozen, paid by hand'
```

Thus a payout completed by hand is settled for resend prevention but invisible to the cadence clock.

**Impact**

After a manually completed distribution, `holdDays` can continue counting from an older automated signature. The 31-day ceiling may then fire too soon on later funds. This does not directly duplicate the manually settled row, but it violates the advertised volume-driven cadence and can cause distributions on successive days when the clock should have reset.

The underlying problem is that `resolvedBy` conflates at least two facts:

- “found the original transfer on-chain” or “paid by hand”;
- “established that nothing landed, but intentionally closed the incident.”

Only the former should count as a payout.

**Evidence**

Evaluate:

```js
holdDays({
  days: {
    '2026-07-01': { paid: { a: { sig: 'old' } } },
    '2026-08-20': {
      paid: {
        a: { sig: null, resolvedBy: 'gary: paid by hand' }
      }
    }
  }
}, '2026-08-22')
```

The current result is `52`, not `2`.

**Fix**

Replace free-form `resolvedBy` as the sole semantic field with an explicit resolution result, for example:

```js
resolution: {
  by: 'gary',
  result: 'paid_on_chain' | 'paid_manually' | 'confirmed_not_paid' | 'waived',
  signature: '...'
}
```

Have `paymentState` and `holdDays` use that same structured result. `paid_on_chain` and `paid_manually` should reset the clock; `confirmed_not_paid` should not.

## MEDIUM — A repaired same-day refusal remains recorded as an active refusal

**Construct**

A refusal writes:

```js
st.days[day].nothingToDo = plan.skip
st.days[day].refused = plan.skip
st.days[day].finishedAt = ...
```

If the operator adds the missing level and reruns on the same day, a successful plan and transfers do not clear `refused` or `nothingToDo`.

The detector continues to apply:

```js
if (rec.refused && !rec.resolvedBy) {
    distribution_refused
}
```

**Impact**

The detector can continue claiming:

> every activated vault is unpaid until it is resolved

after the same-day rerun has paid them. This creates a persistent false HIGH and trains operators to disregard the refusal alarm.

**Evidence**

1. Cause an unlevelled refusal.
2. Add the missing level.
3. Rerun successfully on the same date.
4. Inspect the day record.
5. Run `detectDistribution`.

If correct, `paid` contains successful signatures while `distribution_refused` still fires.

**Fix**

When a valid plan supersedes a refusal, atomically clear or archive the stale state:

```js
delete st.days[day].refused
delete st.days[day].nothingToDo
st.days[day].refusalResolvedAt = ...
```

Alternatively represent attempts as an append-only list instead of overwriting incompatible states on one day object.

## Date-key refusal is not an external griefing surface by itself

The invalid-day-key exception is fail-closed and reaches `main().catch`, which attempts a direct notification. The ledger is a local operational file; no supplied customer path writes arbitrary day keys. An attacker able to modify it already has the ability to corrupt payout records.

The missing control is therefore filesystem integrity and append-only evidence, not permissive date parsing.

## Prototype lookup repair is locally sound

`Object.hasOwn` addresses the relevant inherited-property issue for level values. Vault addresses are base58 public keys, so attacker-selected names such as `__proto__` cannot appear as actual asset identifiers. No additional remotely reachable prototype-key bypass is established in this diff.

---

# R3 — Base64 hardening

## LOW — The script claims canonical base64 but still accepts non-canonical encodings

**Construct**

The new checks enforce:

- alphabet;
- length divisible by four;
- no non-`=` character after the first `=`.

They do not enforce:

- at most two `=` characters;
- valid quantum structure;
- zero unused bits in the final quantum;
- decode-then-reencode equality.

Examples accepted by the shell checks include:

```text
====
A===
AAAA====
AB==
```

`AB==` is a non-canonical encoding of the same byte as `AA==` because the unused final bits are nonzero. Arbitrary extra terminal padding is also accepted by Node.

**Impact**

The particular truncation examples from the previous round are blocked. However, the stronger comment—“demand CANONICAL encoding”—is false, and validation still depends on Node’s permissive decoder. Inputs such as `====` should subsequently fail transaction parsing, so this is not presently a signing bypass. It is a parser-differential hazard and a false control claim.

**Evidence**

Run:

```js
for (const s of ['====', 'A===', 'AB==', 'AA==', 'AAAA====']) {
  const b = Buffer.from(s, 'base64')
  console.log(s, b, b.toString('base64'))
}
```

Accepted strings will re-encode differently from the submitted input.

**Fix**

After stripping permitted whitespace, decode and demand exact canonical round-trip:

```js
const decoded = Buffer.from(input, 'base64')
if (decoded.toString('base64') !== input) refuse()
```

Do this before `Transaction.from`. A standard 1,232-byte transaction encodes to 1,644 characters with ordinary terminal padding and remains accepted.

---

# R4 — New gates

## LOW — The Bank-error gate does not actually enumerate emitted Bank errors

**Construct**

The scraper only sees variants in exactly this shape:

```js
/#\[msg\("[^"]*"\)\]\s*(\w+),/g
```

It misses, among other things:

- an error variant without `#[msg]`;
- an escaped quote in the message;
- another attribute between `#[msg]` and the variant;
- tuple or struct variants;
- formatting changes not matching the exact comma form.

More importantly, this test:

```js
bankErrs.filter(n => !specSrc.includes(n))
```

checks the whole SPEC source, not the parsed control table. Mentioning an error in unrelated prose satisfies a test claiming it is “NAMED in the control table.”

**Impact**

A new confinement error can exist without a control-table row while the gate remains green. Conversely, a commented-out or non-emitted source fragment can be counted as real.

**Evidence**

Either of these mutations should incorrectly leave the relevant arm green:

```rust
BankKeyOutsideNew,
```

without a `#[msg]`, or adding `BankKeyOutsideNew` to ordinary SPEC prose but not to the table.

**Fix**

Parse the Rust syntax or, at minimum, parse the complete `#[error_code]` enum independently of `#[msg]`. Compare the resulting variant set against error names extracted specifically from structured table cells. Do not use whole-file `includes`.

## LOW — “Exactly two verified rows” can count duplicates rather than identities

**Construct**

The arm counts rows ending in a textual conclusion:

```js
rows.filter(r =>
  r.endsWith('claims ON-CHAIN, source says ON-CHAIN')
).length === 2
```

That proves cardinality, not that the two rows correspond to the two distinct controls/programs.

**Impact**

Duplicating one verified row and omitting the other can preserve the expected count, especially because the separate error-name check can be satisfied by prose outside the table.

**Evidence**

Duplicate one ON-CHAIN row, remove the other, and leave both error names elsewhere in SPEC. If the parser still sees five classified rows, both gates can remain green despite the missing control identity.

**Fix**

Assert a keyed mapping, for example:

```text
BankKeyOutsidePair -> cbob-vaults -> ON-CHAIN
BankKeyOutsideMint -> cbob-vault-mint -> ON-CHAIN
```

Require exact unique keys rather than an aggregate count.

## LOW — The signer-constructor gate has a false scope claim

A scan limited to `fromSecretKey` does not enumerate signer creation. `Keypair.fromSeed`, `Keypair.generate`, wallet adapters, decoded key material passed to other APIs, and external signers all evade it.

The already-observed `generate` calls in tests do not by themselves create a production exploit. The problem is that the gate cannot support a claim that it has found the repository’s signer set.

**Evidence**

Add a production signer using:

```js
Keypair.fromSeed(seed)
```

The existing arm will not report it.

**Fix**

Scan semantic signing sinks as well as constructors:

- `partialSign`;
- `sign`;
- `sendAndConfirmTransaction(..., signers)`;
- transaction signing APIs;
- `Keypair.fromSecretKey`, `fromSeed`, and key-loading wrappers.

Classify test-generated ephemeral signers separately from production custody keys.

---

# R5 — Comments and documentation

## HIGH — `cron-install.sh` falsely says installing the cron cannot move money

**Construct**

The header states:

```text
NOTHING HERE MOVES MONEY UNTIL --live IS ADDED TO THE REVENUE LINE.
```

But the installed distribution line is always live:

```cron
/usr/bin/node bank/distribute.mjs
```

`distribute.mjs` loads the distributor private key and sends cbBTC without a `--live` flag.

**Impact**

An operator can install the crontab believing it is entirely non-money-moving, while the next 09:07 run distributes any cbBTC already held by the configured treasury. This can trigger real customer transfers before the operator intended to enable live operations.

**Evidence**

Install the cron with revenue lacking `--live`, fund the distributor cbBTC ATA, and wait for or invoke the distribution cron. SPL transfer signatures will appear despite the header’s “NOTHING” statement.

**Fix**

Change the header immediately:

- revenue swapping is disabled until `--live`;
- distribution is live immediately and can send cbBTC.

Prefer a separate explicit distribution enablement control if installation is intended to be safe for staging.

## LOW — `bank-sign.sh` says the transaction is never an argv blob, but passes it through argv

**Construct**

The comment says:

```text
THE TRANSACTION IS NEVER AN ARGV BLOB.
```

The final command is:

```bash
exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ...
```

The complete base64 transaction is therefore present in the Node process’s argument vector.

**Impact**

Other processes/users with permission to inspect command lines can observe the unsigned transaction. This is not a Bank-key leak and does not itself permit signing, but the documented process-list guarantee is false.

**Evidence**

Pause the Node process and inspect:

```bash
ps -efww
tr '\0' ' ' </proc/$PID/cmdline
```

The transaction appears after `--tx`.

**Fix**

Pass the transaction over stdin or a protected inherited file descriptor. Change `cosign.mjs` to read it there.

## LOW — Live audit material continues to publish stale assertion counts

The generated audit prompt says the suites contain:

- 279 on-chain assertions;
- 388 detector assertions;
- 45 allocation assertions.

The same diff raises the enforced figures to:

- 284;
- 395;
- 56.

This is the inverse defect requested by the prompt: the documentation understates the actual test coverage.

**Evidence**

Compare the literal prompt in `scripts/audit18.ts` with `run-tests.sh` and each suite’s local `FLOOR`.

**Fix**

Generate these numbers from one machine-readable manifest. Do not duplicate them in embedded prompts.

## LOW — The generated architecture summary still says payouts are equal

The `audit18.ts` prompt includes:

```text
daily equal payout to vaults holding at least 21,000 sats
```

The allocator is now weighted 2/3/4/5/6. This sends future auditors a contradictory architecture description even though the changed distribution header was corrected.

**Evidence**

Search the generated prompt or an archived round-18 request for `daily equal payout`.

**Fix**

Replace it with weighted distribution language and gate generated audit prompts against the allocator terminology.

---

# R6 — Independent arithmetic

The published schedule figures re-derive as follows.

### 240-vault census

```text
108×2 + 60×3 + 36×4 + 24×5 + 12×6
= 216 + 180 + 144 + 120 + 72
= 732
```

Per $1,000:

```text
I   1000×2/732 = 2.73
II  1000×3/732 = 4.10
III 1000×4/732 = 5.46
IV  1000×5/732 = 6.83
V   1000×6/732 = 8.20
```

### 2,100-vault census

```text
945×2 + 525×3 + 315×4 + 210×5 + 105×6
= 1,890 + 1,575 + 1,260 + 1,050 + 630
= 6,405
```

Per $1,000:

```text
I   1000×2/6405 = 0.31
II  1000×3/6405 = 0.47
III 1000×4/6405 = 0.62
IV  1000×5/6405 = 0.78
V   1000×6/6405 = 0.94
```

Level shares:

```text
I    1890/6405 = 29.5%
II   1575/6405 = 24.6%
III  1260/6405 = 19.7%
IV   1050/6405 = 16.4%
V     630/6405 =  9.8%
                         100.0%
```

Those listed card figures are arithmetically consistent.

## LOW — The documented worst-case dust bound is materially overstated

**Construct**

The comment says that with denominator 6,405, integer division can leave up to 6,404 sats.

Allocation floors one result per activated vault. Each vault contributes a fractional remainder strictly below one sat, so for `N` paid vaults:

```text
dust < N
```

At 2,100 vaults, integer dust is therefore at most 2,099 sats, regardless of the 6,405 weighted denominator.

**Impact**

This does not misallocate funds, but it overstates the maximum amount deferred from a settlement by more than threefold. It can distort customer disclosures and operational reserve expectations.

**Evidence**

Derive:

```text
available - Σ floor(available × weight_i / denominator)
= Σ fractional_part(...)
< number_of_vaults
```

Property-test across available amounts and confirm `dust < activated.length`.

**Fix**

Document and assert the tighter bound:

```js
r.dust < BigInt(r.activated.length)
```

---

# Carry-over list challenges

## Accepted limit 12 is now operationally significant

The unmeasured-CU item is no longer merely a general omission. Both Bank-signature paths now perform full instruction deserialization and account scans before their main work. It should be promoted from an undifferentiated accepted limit to a release-blocking measurement item, with explicit supported transaction shapes.

## Accepted limit 16 and the distribution halt compound one another

The unverifiable off-chain level register is not only a fairness promise. It is also a global liveness dependency: absence of one entry stops every payment. The level commitment therefore needs availability properties as well as fairness properties—durable publication, backup, recovery, and complete coverage of every minted asset.

No other accepted limit was shown by the supplied material to be materially worse than stated.

---

# Verdict challenges

## HIGH — `audit18.ts` exits successfully when the audit run fails

**Construct**

Per-model failures are converted into ordinary results and written as reports:

```ts
if (j.error) return { model, ok:false, text:`ERROR ...` }
```

There is no final minimum-success condition.

Worse, filesystem failures reject `Promise.all`, but the top-level handler only logs:

```ts
main().catch(e => console.error('FATAL', e?.message || e))
```

It does not set `process.exitCode = 1`.

`OUT` is also not created before `writeFileSync`, so a missing output directory is enough to trigger this path.

**Impact**

The certification runner can exit zero with:

- every model request failed;
- every response containing an API error;
- no report directory;
- no report successfully written;
- all reports cut off by output limits.

With no human firm downstream, this is a direct certification failure: shell automation can treat a nonexistent audit as a completed round.

**Evidence**

Run any of:

```bash
OPENROUTER_API_KEY=invalid node scripts/audit18.ts
OUTDIR=/nonexistent/parent/x node scripts/audit18.ts
MODELS=invalid/model node scripts/audit18.ts
```

Then inspect `$?`. The current structure permits a zero exit despite no usable audit.

**Fix**

The runner must:

1. create and verify `OUT`;
2. reject HTTP non-2xx responses;
3. require a configured minimum number of successful, nonempty, non-truncated reports;
4. require both intended focus bundles if both constitute the round;
5. write a machine-readable receipt;
6. exit nonzero unless all round requirements are met;
7. treat `finish_reason === 'length'` as incomplete, not merely print a warning.

A final manifest should list every requested model, response status, output hash, token counts, finish reason, and whether it counted toward certification.

## MEDIUM — The focused two-pass audit design is described but not enforced

**Construct**

`FOCUS` defaults to `programs`; `offchain` only runs if an operator invokes the script again with a different environment value. Nothing in the script verifies that both passes occurred or that their outputs belong to the same commit.

**Impact**

A round can be declared complete after auditing only the programs or only the off-chain pipeline. Outputs from different commits can also be combined as if they reviewed one frozen target.

**Evidence**

Run the default command once. It exits without any off-chain bundle result or missing-pass failure.

**Fix**

Use one orchestration command that:

- records `git rev-parse HEAD` and dirty-tree status;
- refuses a dirty tree;
- runs both focuses;
- stores each report under that commit;
- validates the required roster and success threshold per focus;
- emits one final signed/hash-addressed round manifest only after both complete.

---

# Anything else

## MEDIUM — Distribution state combines mutually incompatible states in one mutable day record

The stale-refusal issue is one instance of a broader representation defect. A day object can simultaneously contain:

- `nothingToDo`;
- `refused`;
- `finishedAt`;
- a durable `plan`;
- successful `paid` rows;
- unresolved rows.

These are attempts and transitions, not independent booleans. Overwriting one object makes contradictory states easy to create and forces detectors to infer which field is authoritative.

**Evidence**

The same-day refusal-then-success sequence produces such a contradictory object without direct file corruption.

**Fix**

Use an append-only attempt model:

```text
day
  attempts[]
    startedAt
    result: quiet | refused | paying | completed | partial
    planHash
    payments
    supersedesAttempt
```

Derive the current state from the latest valid transition. Validate the ledger against a schema before every run.

---

# Given that no human firm will ever see this

AI rereading the same architecture cannot provide the missing independence. The project should add controls that produce external, adversarial, and mechanically verifiable evidence:

1. **Cap blast radius in protocol and custody.** Keep the Bank signer nearly empty, enforce per-transaction/per-day transfer limits through custody policy, and limit initial cbBTC TVL. Raise caps only after observed production history.

2. **Run a paid public bug bounty before uncapped deposits.** Require executable reproductions against a published local-validator harness. This is not an audit firm; it introduces financially motivated humans who did not inherit the repository’s assumptions.

3. **Build a state-machine model independent of the implementation.** Model mint, activate, distribute, transfer, redeem, burn, rotation, pause, and upgrade transitions in TLA+/Apalache or an equivalent checker. Verify safety and liveness properties rather than more source-text claims.

4. **Add property-based and mutation testing.** Automatically mutate discriminators, account order, signer flags, error variants, ledger states, dates, payment outcomes, and parser inputs. A test suite should be shown to kill the mutations corresponding to its claimed controls.

5. **Use production fault injection before customer funds.** Exercise RPC truncation, DAS inconsistency, confirmation timeout after landing, frozen ATAs, stale locks, reboot during payout, malformed ledgers, missing level entries, partial notification failure, and signer rotation on a mainnet-fork or low-value canary deployment.

6. **Make releases artifact-addressed.** Publish source commit, dependency lockfiles, program ELF hashes, deployed ProgramData hashes, IDLs, operational script hashes, and the audit-round manifest together. A clean review of one commit must not certify a different binary or mutable off-chain tree.

7. **Install independent transaction and balance limits outside this repository.** The signing environment should enforce constraints even if every program, script, comment, and AI verdict is wrong. Repository logic must not be the only boundary around the Bank key or distributor funds.

8. **Predefine and rehearse failure recovery.** Execute drills for Bank-key compromise, distributor-key compromise, bad upgrade, halted distributions, corrupted levels, ambiguous transfers, and unavailable RPC/indexers. Record measured recovery time and the exact authority capable of each action.

Until those measures exist, repeated AI agreement is evidence of repeated reading, not independent certification.