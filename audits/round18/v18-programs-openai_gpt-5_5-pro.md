## R1 — `mint_vault` bank-key confinement

### HIGH — `mint_vault` still permits the Bank key to be used in another role inside an exempt `mint_vault`

**Exact construct**

`programs/cbob-vault-mint/src/lib.rs::mint_vault` exempts any top-level instruction with:

```rust
ix.program_id == crate::ID
&& ix.data[..8] == IX_MINT_VAULT_DISC
```

It does not inspect the exempt instruction’s account positions. But the same handler later does:

```rust
invoke(&system_instruction::transfer(
    &ctx.accounts.payer.key(),
    &revenue,
    cfg.price_lamports,
), ...)
```

and passes `ctx.accounts.payer` as Core’s payer. The account struct allows `bank` and `payer` to be the same pubkey.

**What is gained**

If the Bank signs a mint believing its signature is only the co-signature, a customer can set:

- `owner = attacker`
- `bank = config.bank`
- `payer = config.bank`

The transaction is shaped as a valid `mint_vault`, so the confinement exempts it. The Bank pays the mint price / rent, while the attacker receives the vault and consumes supply. This is not an extra-instruction theft, but it is still spending the Bank signature in a role the confinement does not distinguish.

**Evidence to check**

Build a non-free round and send a single `mint_vault` with the Bank duplicated in the `bank` and `payer` slots. If this finding is right:

- transaction does **not** fail with `BankKeyOutsideMint`;
- `VaultMinted` is emitted for the attacker’s owner key;
- Bank lamports decrease by at least `price_lamports` plus payer costs;
- revenue PDA lamports increase by `price_lamports`.

The test file already uses the Bank key in the payer slot in multiple mint builders; set a nonzero round price to measure the balance movement.

**Fix**

If the Bank is meant only to co-sign mints, enforce that on-chain:

```rust
require_keys_neq!(ctx.accounts.payer.key(), cfg.bank, MintError::BankKeyOutsideMint);
require_keys_neq!(ctx.accounts.asset.key(), cfg.bank, MintError::BankKeyOutsideMint);
```

and, more importantly, when exempting other `mint_vault` instructions in the sysvar walk, parse their account metas and require the Bank pubkey to appear only at the canonical `bank` index, not as `payer`, `asset`, `owner`, or a duplicate remaining account.

If Bank-as-payer is intentional, it must be documented as an accepted limit for MINT too, not only for the redemption pair, and the Bank signing tool needs a mint-specific account-role judge.

---

### LOW — the repair creates a CPI/Squads footgun for future Bank keys

**Exact construct**

Both SEAL and MINT use `load_current_index_checked`. If the instruction is reached by CPI, `current` is the outer top-level instruction, not the inner program invocation. A Squads-style Bank PDA signing by CPI would necessarily appear in the outer Squads instruction’s account list. That outer instruction is not `mint_vault`, `open_for_redemption`, or `burn_vault`, so the confinement rejects it.

**What is gained / lost**

This is not an attacker theft. It is a configuration footgun: rotating `config.bank` to a PDA/multisig that signs by CPI can halt minting/redemption even though `Signer<'info>` would otherwise accept PDA CPI signers.

**Evidence to check**

Set `config.bank` to a PDA controlled by a wrapper program and invoke `mint_vault` or `open_for_redemption` by CPI with that PDA signer. Expected result: `BankKeyOutsideMint` or `BankKeyOutsidePair`.

**Fix**

Either state and alarm that the Bank must be a top-level Ed25519 signer, or explicitly support one audited wrapper path. Do not leave “Signer can be PDA by CPI” and “Bank confinement forbids the wrapper instruction” as an implicit interaction.

---

### R1 notes

- The instructions-sysvar address pin should fail old positional clients closed: an old client will pass `seal_config` where `instructions` is now expected, and Anchor’s address constraint should reject before the handler transfers SOL.
- The `seen_self` guard is sufficient against the specific early-stop shape if Solana’s runtime-generated instruction sysvar is well formed and densely indexed. A walk reaching `current` but missing later valid instructions would require a malformed sysvar, not just a crafted transaction.
- The fee payer really is not visible to these handlers unless it is also named in an instruction account list. Keep treating that as policy, and keep the Bank hot wallet’s SOL float minimal.

---

## R2 — cadence and weighted distribution repairs

### MEDIUM — impossible calendar dates are still accepted; the new test asserts the wrong value

**Exact construct**

`bank/distribute.mjs` validates only shape:

```js
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
```

Then relies on `dayDiff`/`Date.parse`. The new comment says `2026-02-30` is refused by the finiteness check, but JavaScript rolls it into March. The added selftest proves the defect:

```js
t('...shaped-but-impossible date does not produce a confident wrong answer',
  (() => { try { return holdDays({ days: {
    '2026-02-30': { paid: { a: { sig: 'x' } } }
  } }, '2026-08-22') } catch { return 'REFUSED' } })(), 173)
```

It expects `173`, not `REFUSED`.

**What is gained**

A malformed ledger day can reset or distort the max-hold clock. That can force distributions early or prevent the 31-day ceiling from firing when it should. This is not a public on-chain grief unless customers can write the ledger, but it is a live money-job correctness bug.

**Evidence to check**

Run:

```js
holdDays({
  days: { '2026-02-30': { paid: { a: { sig: 'x' } } } }
}, '2026-08-22')
```

Current expected result from the suite is `173`. Correct behavior should be refusal.

**Fix**

Replace shape validation with strict calendar validation:

```js
function parseIsoDayStrict(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`bad day ${s}`)
  const ms = Date.parse(`${s}T00:00:00.000Z`)
  if (!Number.isFinite(ms)) throw new Error(`bad day ${s}`)
  if (new Date(ms).toISOString().slice(0, 10) !== s) {
    throw new Error(`impossible calendar day ${s}`)
  }
  return ms
}
```

Make `dayDiff` use this parser for both endpoints.

---

### MEDIUM — `resolved` rows are not enough information for `holdDays`

**Exact construct**

`holdDays` now resets only on:

```js
paymentState(row) === 'paid'
```

But the suite documents rows like:

```js
{ amount: '5', sig: null, resolvedBy: 'gary: found it on chain' }
```

as `paymentState(...) === 'resolved'`.

**What is gained**

A human-resolved row may mean “found the payment on-chain”, which should reset the payout clock. It may also mean “waived / not owed / manually handled”, which should not necessarily reset it. The current single `resolved` state cannot express the difference, so `holdDays` must be wrong for at least one real resolution type.

**Evidence to check**

Use:

```js
const real = { paid: { a: { amount: '9', sig: 'A_REAL_SIGNATURE' } } }
const resolvedPaid = { paid: {
  a: { amount: '9', sig: null, resolvedBy: 'gary: found it on chain' }
}}

holdDays({
  days: { '2026-07-01': real, '2026-08-20': resolvedPaid }
}, '2026-08-22')
```

Current behavior counts only July as paid and returns `52`. If the August row was truly found on-chain, the correct cadence value is `2`.

**Fix**

Make resolution structured, not free text:

```js
resolvedAs: 'paid' | 'waived' | 'not_owed' | 'operator_error'
```

Then `holdDays` should count `paid` and `resolvedAs === 'paid'`, not every `resolvedBy` and not no `resolvedBy`.

---

### HIGH — the unlevelled-vault halt remains a public payout DoS

**Exact construct**

`allocateWeighted` does:

```js
const unlevelled = activated.filter(v =>
  !Object.hasOwn(LEVEL_WEIGHTS, levels[v] ?? '')
)

if (unlevelled.length) {
  return { ...empty, refusal: true, skip: `${unlevelled.length} activated vault(s) carry no level...` }
}
```

Then `main()` records the refusal and returns before paying anyone.

**What is gained**

Any customer who can mint a vault and fund it with the activation threshold can stop every distribution until an operator assigns a level and resolves the ledger day. The attacker’s cost is the activation funding plus mint costs; the effect is global payout delay.

The author’s accounting argument is partly right: silently excluding the vault can overpay everyone else. But “halt everyone” is still a public availability attack. It needs to be treated as such, not merely as a clean accounting refusal.

**Evidence to check**

Call:

```js
allocateWeighted(
  { attackerVault: 21_000n },
  {},
  1_000_000n
)
```

Expected current result: `refusal: true`, no payments. Then run `detectDistribution` on the recorded ledger day; it should emit `distribution_refused`.

**Fix**

Make level assignment atomic with activation, or make the level registry on-chain / committed before a vault can become payout-eligible. If off-chain levels remain, introduce a defined quarantine/escrow rule for unlevelled activated vaults instead of letting one missing level halt the entire population.

---

### LOW — the detector test stops at the finding list, not the human notification path

**Exact construct**

The new selftest directly calls:

```js
D.detectDistribution(refused, { today })
```

and asserts that `distribution_refused` appears at HIGH. It does not prove that `bank/alarm.mjs`, cron, the notifier, or paging path actually delivers that HIGH to a human.

**What is gained**

A refusal can be represented correctly in `detectors.mjs` and still be operationally silent if the consuming path filters, logs only, exits zero, or does not page HIGH severity.

**Evidence to check**

Run the actual alarm/cron entrypoint against a fixture ledger containing:

```js
{ refused: '1 activated vault(s) carry no level: abc', finishedAt: '...' }
```

The evidence should be an observable notification or nonzero alert artifact, not only a detector return value.

**Fix**

Add an end-to-end alarm test with a fake notifier sink and assert that `distribution_refused` reaches that sink at HIGH.

---

### LOW — the new prototype-level tests are partly vacuous

**Exact construct**

In `bank/distribute.mjs` selftest:

```js
allocateWeighted(...).skip !== null
```

This is true even if `skip` is `undefined`, which is what a successful non-skip allocation would likely have.

**What is gained**

A future regression that stops refusing bad levels could still pass this assertion if the returned object simply lacks `skip`.

**Evidence to check**

Temporarily make `allocateWeighted` ignore unlevelled vaults and return a normal plan with no `skip`. The assertion `skip !== null` remains true.

**Fix**

Assert the actual refusal shape:

```js
const r = allocateWeighted(...)
t('...', r.refusal, true)
t('...', typeof r.skip, 'string')
```

---

## R3 — `scripts/bank-sign.sh` base64 hardening

### MEDIUM — the new check is still not canonical base64

**Exact construct**

The script now enforces:

```sh
*[!A-Za-z0-9+/=]*   # alphabet
*=*[!=]*            # no non-'=' after '='
${#TX} % 4 == 0
```

It does not limit padding to at most two `=` characters and does not reject nonzero trailing bits in the final quantum.

**Accepted bad examples**

These pass the shell checks:

```text
====
A===
AAAA====
AB==
/z==
```

Node behavior to check:

```sh
node -e "console.log(Buffer.from('====','base64').length)"
# 0

node -e "console.log(Buffer.from('AAAA====','base64').toString('base64'))"
# AAAA

node -e "console.log(Buffer.from('AB==','base64').toString('base64'))"
# AA==

node -e "console.log(Buffer.from('/z==','base64').toString('base64'))"
# /w==
```

So the script still accepts strings whose canonical base64 representation is different from what was pasted.

**What is gained**

This is narrower than the old mid-padding truncation bug because data after padding is now rejected. But it still violates the stated “canonical encoding” invariant and can desynchronize text-level approvals, logs, or hashes from the transaction bytes actually judged and signed.

**Fix**

After stripping whitespace, enforce canonical padded base64 by regex and round-trip:

```sh
node - "$TX" <<'NODE'
const s = process.argv[2]
const re = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
if (!s || !re.test(s)) {
  console.error('non-canonical base64')
  process.exit(2)
}
const b = Buffer.from(s, 'base64')
if (b.toString('base64') !== s) {
  console.error('base64 has non-canonical trailing bits or padding')
  process.exit(2)
}
NODE
```

A real 1232-byte transaction encodes to 1644 characters, one final `=`, and passes this.

---

## R4 — gates added this round

### MEDIUM — the `BankKeyOutside*` SPEC gate is too weak and too narrow

**Exact construct**

`bank/selftest.mjs` scrapes only two files:

```js
const bankErrs = [
  'programs/cbob-vaults/src/lib.rs',
  'programs/cbob-vault-mint/src/lib.rs'
].flatMap(errNames)
```

with:

```js
/#\[msg\("[^"]*"\)\]\s*(\w+),/g
```

and checks only:

```js
specSrc.includes(n)
```

**What is missed**

This misses:

- a future `BankKeyOutside*` in BURN or GOV;
- a variant without a trailing comma;
- a variant without `#[msg]`;
- raw-string messages;
- multiline `#[msg(...)]`;
- names mentioned in SPEC prose but missing from the control table.

**What is gained**

The exact class this gate was meant to prevent can still recur: a live refusal can exist in Rust while the control table lacks a classified row for it.

**Evidence to check**

Add this to `programs/cbob-vault-burn/src/lib.rs`:

```rust
#[msg("bank outside burn")]
BankKeyOutsideBurn,
```

Current gate does not scan that file. Or put `BankKeyOutsideMint` in SPEC prose but remove its table row; `specSrc.includes(n)` can still pass.

**Fix**

Scan all `programs/*/src/lib.rs`. Better: generate errors from Anchor IDL or parse Rust with `syn`. Then assert set equality against parsed SPEC table rows, not `specSrc.includes`.

---

### LOW — the “exactly two ON-CHAIN rows” gate is count-based, not identity-based

**Exact construct**

```js
rows.filter(r => r.endsWith('claims ON-CHAIN, source says ON-CHAIN')).length === 2
```

**What is gained**

Two rows can satisfy the count while one of the intended controls is missing, duplicated, or misclassified.

**Evidence to check**

Duplicate the SEAL row and remove the MINT row while leaving `BankKeyOutsideMint` somewhere else in SPEC text. A count-only test is the wrong invariant.

**Fix**

Assert the exact expected set, e.g.:

```js
{
  BankKeyOutsidePair: 'ON-CHAIN',
  BankKeyOutsideMint: 'ON-CHAIN'
}
```

and bind each row to the Rust error it names.

---

### LOW — signer-set scanning is incomplete but not shown exploitable here

**Exact construct**

The gate matches `Keypair.fromSecretKey` but not `Keypair.fromSeed` or `Keypair.generate`.

**Assessment**

If the `fromSeed` / `generate` occurrences are only in tests or fixture builders, this is untidy gate drift, not a funds bug. It becomes exploitable if a production signing path can generate or derive an authority key internally instead of loading the intended signer.

**Evidence to check**

Run a path-classified grep:

```sh
grep -R "Keypair\.fromSeed\|Keypair\.generate\|fromSecretKey" bank scripts programs tests
```

If occurrences outside tests can sign production transactions, escalate.

**Fix**

Gate all signer constructors and classify allowed locations by path. Production signing code should load explicit configured keys only.

---

## R5 — comment and documentation defects in this diff

### LOW — multiple comments still overstate, understate, or contradict running code

**Exact constructs**

1. `bank/cosign.mjs` says confinement is on-chain “in both programs that take the Bank’s signature.” BURN also takes `bank: Signer`; BURN relies on SEAL’s preceding/open pairing rather than carrying its own `BankKeyOutside*` check.

2. `bank/distribute.mjs` says `2026-02-30` is refused by finiteness checking. It is not; the new test expects `173`.

3. `scripts/bank-sign.sh` says the new checks demand canonical encoding. They do not; see R3.

4. `scripts/cron-install.sh` says distribution pays based on volume / `EMISSION_MIN_PER_VAULT`. That underclaims the max-hold forced-payout path.

5. `bank/distribute.mjs` says activating is worth something “the day you do it.” An activated but unlevelled vault currently halts all payouts.

6. In the provided MINT file, `MintError::BadSplit` still says the whole-percent rule exists “so the royalty plugin can express it,” while nearby code comments say that reason was false.

**What is gained**

Operators and future auditors will make decisions from false prose. The project has repeatedly shipped defects from comments drifting in both directions; these are more examples.

**Evidence to check**

Each item above is a direct grep target. For item 2, the selftest itself is executable evidence.

**Fix**

Do not restate controls in prose unless generated from a single machine-readable control table. Where prose is necessary, add negative tests for underclaims as well as overclaims.

---

## R6 — arithmetic re-derivation

Weights are I–V = `2/3/4/5/6`.

### Census denominator

For `108/60/36/24/12`:

```text
108*2 + 60*3 + 36*4 + 24*5 + 12*6
= 216 + 180 + 144 + 120 + 72
= 732
```

For `945/525/315/210/105`:

```text
945*2 + 525*3 + 315*4 + 210*5 + 105*6
= 1890 + 1575 + 1260 + 1050 + 630
= 6405
```

### Per-vault payout per $1,000

Using denominator `732`:

```text
I   1000*2/732 = 2.732240437
II  1000*3/732 = 4.098360656
III 1000*4/732 = 5.464480874
IV  1000*5/732 = 6.830601093
V   1000*6/732 = 8.196721311
```

Using denominator `6405`:

```text
I   1000*2/6405 = 0.312256050
II  1000*3/6405 = 0.468384075
III 1000*4/6405 = 0.624512100
IV  1000*5/6405 = 0.780640125
V   1000*6/6405 = 0.936768150
```

### Level share of total emissions

The level-wide shares are the same for both schedules:

```text
I   216/732  = 29.5081967213%
II  180/732  = 24.5901639344%
III 144/732  = 19.6721311475%
IV  120/732  = 16.3934426230%
V    72/732  =  9.8360655738%
```

Rounded to one decimal:

```text
29.5% + 24.6% + 19.7% + 16.4% + 9.8% = 100.0%
```

Any customer-facing card with different figures should be treated as wrong.

---

## Carry-over list: items that got worse or interact with this diff

### LOW — compute units are now more important than the accepted limit states

The known compute-unit gap worsened because MINT now scans every top-level instruction, and every batched `mint_vault` repeats that scan. SEAL does the same for redemption. This is probably bounded by the 1232-byte transaction limit, but it is still unmeasured.

**Evidence to collect**

Add tests that log CU for:

- ordinary mint;
- mint plus maximum harmless top-level instructions;
- batched mints;
- worst-case redemption with three reserve mints and bank confinement.

**Fix**

Put CU ceilings into tests. If batching is intended, measure the intended maximum batch, not only one-instruction happy paths.

---

### HIGH interaction — accepted off-chain level registry now has a public halt consequence

Known limit #16 says levels are off-chain. This diff makes the operational consequence explicit: missing level data halts all distributions. That is worse than “holders cannot verify assignment”; it is also a public payout DoS until level assignment is atomic or quarantined.

---

### HIGH interaction — if Bank-as-payer in MINT is intended, it must be listed as an accepted limit

Known limit #3 says the Bank may be named `payer` inside the redemption pair. The same shape exists in MINT, but it is not listed. If intentional, document it. If not intentional, fix R1.

---

## Verdict challenges

Any verdict saying “the Bank signature is now confined on-chain” is too broad unless it says all three exceptions plainly:

1. fee payer remains policy-only;
2. approved redemption instructions may still use the Bank in approved-instruction payer roles, per accepted limit;
3. MINT currently permits the Bank to be `payer` inside an exempt `mint_vault`.

Any verdict saying “ledger date validation is fixed” is false until impossible shaped dates like `2026-02-30` are rejected.

Any verdict saying “distribution refusal alerts humans” is not proven by the added tests. The tests prove detector output, not notification delivery.

---

## Anything else

### LOW — `Object.hasOwn` may create a runtime-version footgun

`Object.hasOwn` requires a sufficiently modern Node runtime. If production cron runs under older Node, the money job throws before distribution.

**Evidence to check**

Run production’s actual Node:

```sh
node -p "process.version, typeof Object.hasOwn"
```

**Fix**

Either pin Node in deployment or use:

```js
Object.prototype.hasOwnProperty.call(LEVEL_WEIGHTS, key)
```

---

## Given no human firm will ever see this

Do these concrete things that repeated AI review will not reliably substitute for:

1. **Eliminate raw base64 signing.** The Bank should sign typed intents, not pasted transactions. The tool should construct or independently decode the transaction, display account roles, signer roles, writable accounts, lamport/token deltas, and require an operator approval over that parsed intent.

2. **Separate Bank roles by key.** The co-signer key should not be a fee payer and should hold minimal SOL. Use separate keys for fee payment, mint co-signing, redemption co-signing, and swap operation.

3. **Add mechanical adversarial generators.** Fuzz account aliasing, duplicate metas, CPI wrappers, versioned transactions with ALTs, malformed ledgers, noncanonical base64, and partial distribution failures. These are the shapes repeatedly producing findings.

4. **Add end-to-end alert drills.** A detector unit test is not enough. Inject a refused distribution, corrupt ledger date, stuck flock, unlevelled vault, and partial payment into a staging ledger and prove the actual pager/notifier fires.

5. **Stage launch with hard blast-radius limits.** Start with capped Bank SOL, capped sweep size, canary vaults, and a published rollback/rotation drill. Do not let the first real failure exercise the full treasury.

6. **Make level assignment non-optional before activation.** Either put levels on-chain, or publish a signed/committed level registry before vaults can become payout-eligible. The current off-chain register is both an unverifiable promise and a payout halt lever.

7. **Run an external adversarial contest.** If there is no audit firm, create the next best thing: frozen commit, public rules, real bounty, and explicit rewards for testable exploits or doc/control mismatches. AI rounds are finding many repair bugs, but they are also producing false criticals; external adversaries with incentives add a different failure mode.