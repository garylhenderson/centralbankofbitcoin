# R1 — `mint_vault` bank-key confinement

## HIGH — Exempt `mint_vault` instructions can spend the Bank’s SOL through the `payer` role

**Construct**

```rust
let is_mint = ix.program_id == crate::ID
    && ix.data.len() >= 8
    && ix.data[..8] == IX_MINT_VAULT_DISC;

if !is_mint {
    require!(!ix.accounts.iter().any(|a| a.pubkey == bank), ...);
}
```

The exemption covers the entire instruction solely because it dispatches to `mint_vault`. It does not restrict where the Bank appears inside that instruction.

`MintVault` contains both:

```rust
pub bank: Signer<'info>,
#[account(mut)]
pub payer: Signer<'info>,
```

The supplied tests already pass the same Bank pubkey in both positions. Consequently, an exempt mint can:

* transfer `config.price_lamports` from the Bank to the revenue PDA;
* make the Bank fund Core asset creation/rent;
* issue the resulting vault to an attacker-controlled owner;
* be repeated through several sibling `mint_vault` instructions covered by one Bank signature.

This is not the rejected `SystemProgram.transfer(from=BANK)` shape, but it still spends the Bank’s signature outside the narrow co-signer role. The claim that every exempt mint “names the Bank exactly as this one does” is not a security property: account roles and duplicate occurrences are unconstrained.

**Gain**

A customer who obtains a Bank signature over a composed mint transaction can obtain Bank-funded vaults and consume the Bank’s SOL float. The lifetime and round caps bound the number of vaults, but not the accidental authorization represented by one signature approving multiple mints.

This does not directly reach customer cbBTC, so it is HIGH rather than CRITICAL.

**Evidence**

Build a transaction containing two valid `mint_vault` instructions:

1. the mint the Bank believes it is approving;
2. a second mint with:
   * `bank = config.bank`;
   * `payer = config.bank`;
   * attacker as `owner`;
   * a fresh attacker-controlled asset signer.

Expected evidence if this finding is correct:

* both mints succeed;
* `BankKeyOutsideMint` does not fire;
* the Bank balance falls by the second mint’s price and Core creation costs;
* the attacker owns the second vault.

The existing test fixtures already establish that duplicate `bank`/`payer` binding is accepted.

**Fix**

Choose and enforce one explicit policy:

1. **Bank must never pay:** reject any exempt mint where the Bank appears anywhere except the exact `bank` account position.
2. **Bank may sponsor one mint:** require exactly one top-level `mint_vault` in the transaction and pin the Bank’s permitted positions.
3. **Batch sponsorship is required:** add a Bank-controlled authorization account or nonce committing to the exact mint count, owners, assets and maximum aggregate Bank debit.

At minimum, inspect every exempt mint’s account metas and reject the Bank in `payer`, `owner`, `asset`, or unexpected/remaining positions unless that role is deliberately authorized.

---

## R1 observations that did not produce findings

### The instructions-sysvar pin is effective

```rust
#[account(address = sysvar::instructions::ID)]
pub instructions: UncheckedAccount<'info>,
```

An old positional client will fail the address constraint when its former `seal_config` account is interpreted as `instructions`; it should not silently bind an arbitrary account as the sysvar.

The shown hand-built test instructions were updated for the inserted position. That does not prove every external client or cached IDL was updated, but stale clients fail closed.

### `seen_self` is sufficient against an attacker-supplied fake sysvar, but still relies on runtime sysvar well-formedness

The address constraint prevents substitution. For the runtime-produced instructions sysvar, reaching `current` and then stopping at the first out-of-range index should mean the whole valid suffix was traversed.

There is no demonstrated way for a transaction author to make the real sysvar deserialize through `current` but fail on a later valid instruction. The safer implementation would still read the declared instruction count and iterate exactly that range, distinguishing “end of list” from malformed-data errors.

### The fee-payer limitation is real

The fee payer is not automatically included in each instruction’s account-meta list. If the Bank is only the transaction fee payer, neither confinement walk can identify that role from the loaded instructions. If the same key is also explicitly used by an instruction, that explicit occurrence is visible, but its fee-payer status remains invisible.

### Discriminator check

The supplied value for `sha256("global:mint_vault")[..8]` is consistent with the stated derivation:

```text
[29, 76, 246, 26, 123, 202, 230, 234]
```

I found no evidence in the supplied material contradicting the existing open and burn discriminator constants.

---

# R2 — Cadence and weighting repairs

## MEDIUM — Impossible calendar dates still pass, and the new test certifies the wrong result

**Construct**

```js
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
...
const n = dayDiff(anchor, day)
if (!Number.isFinite(n)) throw ...
```

The comment says:

> `2026-02-30` ... is still refused by `dayDiff`'s finiteness check

That is false for JavaScript date parsing implementations that normalize the date into March. The result is finite, so the check accepts it.

Worse, the new self-test explicitly expects the wrong computed value:

```js
t('...does not produce a confident wrong answer',
  (() => {
    try {
      return holdDays({ days: {
        '2026-02-30': { paid: { a: { sig: 'x' } } }
      } }, '2026-08-22')
    } catch {
      return 'REFUSED'
    }
  })(),
  173)
```

The description says refusal; the expected result is `173`. This is a measured false negative embedded in the gate.

**Impact**

A malformed ledger date can become the payout anchor and change when forced emission occurs. This can delay or accelerate payouts depending on the normalized date.

A stranger does not appear able to write this local ledger directly. The likely trigger is an operator bug, migration or manual edit, so this is an integrity/availability defect rather than a public attack.

**Evidence**

Run:

```js
holdDays(
  { days: { '2026-02-30': { paid: { a: { sig: 'x' } } } } },
  '2026-08-22'
)
```

The supplied self-test itself predicts `173`, proving the invalid key is accepted rather than refused.

**Fix**

Validate by round trip, not shape plus finiteness:

```js
function validIsoDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y &&
         date.getUTCMonth() === m - 1 &&
         date.getUTCDate() === d
}
```

Change the test expectation to `REFUSED`. Add leap-year boundaries, month zero/13 and days 00/29/30/31 as appropriate.

---

## MEDIUM — A manually resolved payment that was found on-chain does not reset the hold clock

**Construct**

```js
const paid = days.filter(d =>
  Object.values(st.days[d]?.paid || {})
    .some(r => paymentState(r) === 'paid')
)
```

The repository expressly uses a resolution such as:

```js
{
  amount: '5',
  sig: null,
  resolvedBy: 'gary: found it on chain'
}
```

and classifies it as `resolved`, not `paid`.

Therefore, a transfer that really landed but was initially ambiguous and later confirmed by a human does not count as a payout for `holdDays`. “Resolved” currently conflates at least:

* confirmed paid on-chain;
* confirmed rejected/unpaid;
* administratively waived or otherwise settled.

Only the first should reset the cadence.

**Impact**

A genuinely paid day may fail to reset the clock. Forced emission can occur sooner than intended. The per-row settled state may prevent an exact duplicate transfer, but the cadence and pool-level emission decision become wrong.

**Evidence**

Use:

```js
const old = {
  paid: { a: { amount: '9', sig: 'OLD_SIG' } }
}
const foundOnChain = {
  paid: {
    a: {
      amount: '9',
      sig: null,
      resolvedBy: 'gary: found it on chain'
    }
  }
}
```

If the finding is correct, `holdDays` anchors on `old`, not `foundOnChain`, despite the latter representing a real on-chain payment.

**Fix**

Make resolution outcome structured:

```js
resolution: {
  outcome: 'paid' | 'unpaid' | 'waived',
  resolvedBy,
  resolvedAt,
  chainSignature
}
```

Have `paymentState` return `paid` for a chain-confirmed paid resolution. Do not infer payment merely from free-form `resolvedBy` text.

---

## HIGH — Any newly activated unlevelled vault can repeatedly halt all distributions

**Construct**

```js
const unlevelled = activated.filter(
  v => !Object.hasOwn(LEVEL_WEIGHTS, levels[v] ?? '')
)
if (unlevelled.length) {
  return { ...empty, refusal: true, skip: ... }
}
```

The new detector makes the halt visible, but it does not remove the public griefing mechanism. A customer can activate a vault before its off-chain level is present. One such vault stops payment to every other holder.

After an operator assigns that level, another newly activated unlevelled vault can repeat the halt. This is not merely a one-time recoverable configuration error.

The Bank signature required to mint limits the attacker to an approved customer, but an otherwise legitimate customer can trigger the halt through the ordinary activation path.

**Gain**

An attacker can delay every holder payout for the cost of acquiring and funding vaults, forcing repeated emergency edits to `levels.json`. Detection does not restore availability.

The author is correct that silently excluding the vault and splitting the entire pool among known levels overpays them. That does not justify making one missing off-chain record a global indefinite halt.

**Evidence**

1. Mint a vault through the ordinary approved path.
2. Fund it to at least 21,000 sats.
3. Leave it absent from `levels.json`.
4. Run distribution.

Expected evidence:

* `allocateWeighted` returns `refusal: true`;
* zero transfers are made to all otherwise eligible vaults;
* `distribution_refused` is generated;
* repeating with a second unlevelled vault re-establishes the halt after the first is repaired.

**Fix**

Prefer one of:

* make level assignment a prerequisite in the Bank’s mint workflow and write it durably before the customer can activate;
* place unlevelled vaults in an explicit pending state and reserve a conservative maximum-weight entitlement for them, distributing only the safely available remainder;
* publish and commit the assignment before activation, then reveal it without requiring an emergency manual edit;
* isolate the undistributable day’s pool rather than blocking all future pools.

An alert is necessary but is not a liveness control.

---

## Notification trace is not established by the supplied code

The diff proves only that `detectDistribution` appends a HIGH finding. It does not contain the alarm-to-notification dispatch, recipient configuration, escalation or delivery acknowledgement.

Required evidence before treating this as human-reaching:

1. inject a `refused` ledger entry;
2. run the actual scheduled alarm command, not `detectDistribution` directly;
3. capture the outbound notification;
4. verify non-zero failure and retry behavior when the notification provider is unavailable;
5. verify the configured production recipient receives `distribution_refused`.

This is an unverified control in this bundle, not a claim that the notification path is broken.

---

# R3 — Base64 hardening

## LOW — The script still accepts non-canonical and excessive-padding encodings

**Construct**

The new checks enforce only:

* alphabet membership;
* total length divisible by four;
* no non-`=` characters after the first `=`.

They do not enforce:

* at most two padding characters;
* valid quantum length before padding;
* zero unused bits in the final quantum;
* canonical re-encoding.

Examples accepted by the shell checks include:

```text
AB==
A===
AAAA====
```

`AB==` has non-zero unused trailing bits and decodes to the same byte as canonical `AA==`. Excess padding such as `AAAA====` is also silently ignored by `Buffer.from(..., 'base64')`.

**Impact**

The textual value judged by the script is not guaranteed to be a canonical representation of the decoded bytes. Later transaction parsing should reject empty or undersized results, so this is not by itself evidence that a different valid transaction will be signed. It does, however, leave the exact parser-differential class the comments claim to have eliminated.

**Evidence**

Run:

```js
for (const x of ['AB==', 'A===', 'AAAA====']) {
  const b = Buffer.from(x, 'base64')
  console.log(x, b.length, b.toString('hex'), b.toString('base64'))
}
```

The re-encoded values differ from the accepted input.

**Fix**

After decoding:

```js
const decoded = Buffer.from(input, 'base64')
if (decoded.toString('base64') !== input) reject()
```

Also reject empty input and enforce a maximum decoded transaction size before parsing.

A canonical 1232-byte transaction encodes to 1644 characters with one trailing `=`, so this fix does not reject that legitimate case.

---

# R4 — Certification gates

## MEDIUM — The new control-table gate does not prove that errors are named in the table

**Construct**

```js
bankErrs.filter(n => !specSrc.includes(n))
```

This passes if an error name appears anywhere in `SPEC.md`, including:

* prose outside the table;
* a historical note saying the control does not exist;
* a code block;
* a comment or unrelated section.

The assertion text says “NAMED in the control table,” but the implementation checks substring occurrence in the whole file.

The Rust extraction is also regex-fragile:

```js
/#\[msg\("[^"]*"\)\]\s*(\w+),/g
```

It misses variants with:

* an escaped quote in the message;
* a raw string;
* another attribute between `#[msg]` and the variant;
* formatting or syntax outside this exact layout;
* a confinement error not named with the `BankKeyOutside` prefix;
* a new relevant program not added to the hard-coded two-file list.

**Impact**

A newly added on-chain confinement error can remain absent from the actual control table while the certification gate passes. With this process acting as certification, that is a substantive assurance failure.

**Evidence**

Move `BankKeyOutsideMint` out of the table and mention it once in unrelated SPEC prose. The test should still pass.

Likewise, change an error to:

```rust
#[msg(r#"the Bank's "key" is outside"#)]
BankKeyOutsideMint,
```

and check whether `errNames` still extracts it.

**Fix**

* Parse Rust with `syn`, rustdoc JSON or another syntax-aware mechanism.
* Parse the SPEC table into structured rows.
* Require a row whose dedicated control/error-name field exactly equals each emitted error.
* Maintain an explicit inventory of Bank-signing instructions/programs rather than relying only on an error-name prefix.
* Mutation-test the gate by deleting rows, moving names to prose and changing Rust formatting.

---

## LOW — Exact source-text row counts remain brittle evidence

The assertion that exactly two rows end with:

```text
claims ON-CHAIN, source says ON-CHAIN
```

proves agreement with the parser’s source-text heuristic, not the actual runtime property. A duplicated row can replace a missing row while preserving the count, and semantically equivalent source refactoring can change the classification.

Fix this by keying rows by unique control ID and requiring the exact expected set, not only a count.

---

## Signer-set scanner limitation

Scanning only `fromSecretKey` is not a complete inventory of key creation. `Keypair.fromSeed`, `Keypair.generate`, wallet adapters, decoded secret arrays and external signer APIs all produce signing authorities.

`Keypair.generate` in tests or for fresh Core asset signers is expected and not inherently exploitable. `fromSeed` is dangerous only if used to derive a production authority from predictable or repository-held material.

Required evidence is a call-site inventory identifying:

* which generated keys can authorize value movement;
* whether any deterministic seed is public or committed;
* whether generated keys are ephemeral asset signers or production authorities.

The present scanner cannot support a claim that it enumerates the signer set.

---

# R5 — Comments and operator-facing claims

## LOW — `cosign.mjs` says there are only two programs taking the Bank signature

The changed comment says:

> “in both programs that take the BANK’S SIGNATURE”

There are three programs with Bank signer accounts in the supplied code:

* MINT;
* SEAL;
* BURN.

BURN inherits transaction confinement transitively because it requires a preceding SEAL open, but BURN itself takes the Bank signature and does not contain its own confinement walk.

**Evidence:** search the three `Accounts` structs for `bank: Signer`.

**Fix:** say:

> “The two confinement checks are in MINT and SEAL. BURN also requires the Bank signature, and its transaction is confined transitively because every successful BURN requires a preceding successful SEAL open.”

---

## LOW — SEAL still says `BurnV1` “closes” the asset

The comment says:

> “nothing can be done with an asset after `BurnV1` closes it anyway.”

The measured fact supplied in the prompt says the asset account survives as Core-owned `Key::Uninitialized`; it is not closed.

The intended security conclusion may still hold—Core no longer treats it as a live asset—but the stated mechanism is false.

**Evidence:** after BurnV1, inspect account existence, owner, lamports and first data byte.

**Fix:** replace “closes it” with “leaves it non-live at `Key::Uninitialized`.”

---

## LOW — The `BadSplit` operator error still repeats a deleted justification

The code comments correctly say whole-percent splits are a business rule, not a royalty-plugin limitation. The emitted error still says:

```rust
#[msg("split_bps must be <= 10000 and a multiple of 100 so the royalty plugin can express it")]
BadSplit,
```

That is false according to the adjacent corrected implementation comments.

**Fix:** change it to:

> “split_bps must be <= 10000 and a multiple of 100; the holder/Bank split is defined in whole percentage points.”

---

## LOW — The calendar-validation comment and test claim the inverse of execution

The new comment states that `2026-02-30` is refused, while the new test expects `173`. This is not merely stale prose; it makes the certification output describe a passing wrong result as a refusal.

Fix together with the R2 calendar finding.

---

# R6 — Independent arithmetic

The two denominators are correct.

## Launch census

Weights `I–V = 2/3/4/5/6`:

```text
108×2 = 216
 60×3 = 180
 36×4 = 144
 24×5 = 120
 12×6 =  72
Total = 732
```

Shares:

```text
I    216/732 = 29.5082%
II   180/732 = 24.5902%
III  144/732 = 19.6721%
IV   120/732 = 16.3934%
V     72/732 =  9.8361%
```

Rounded to one decimal:

```text
29.5 + 24.6 + 19.7 + 16.4 + 9.8 = 100.0%
```

Per-vault payout from a $1,000 pool:

```text
I    1000×2/732 = $2.732240...
II   1000×3/732 = $4.098361...
III  1000×4/732 = $5.464481...
IV   1000×5/732 = $6.830601...
V    1000×6/732 = $8.196721...
```

## Full census

```text
945×2 = 1,890
525×3 = 1,575
315×4 = 1,260
210×5 = 1,050
105×6 =   630
Total   = 6,405
```

Per-vault payout from a $1,000 pool:

```text
I    2000/6405 = $0.312256...
II   3000/6405 = $0.468384...
III  4000/6405 = $0.624512...
IV   5000/6405 = $0.780640...
V    6000/6405 = $0.936768...
```

The full census is exactly 8.75 times the launch census at every level, so the percentage shares are identical.

No arithmetic defect was established in the published totals described in the prompt.

---

# Carry-over list assessment

I am not re-filing the accepted limits. Two require stronger treatment than their current wording suggests:

1. **Compute-unit exposure worsened with both full-transaction walks.** Transaction packet size bounds the number of instructions and metas, but that does not prove the worst valid redemption or mint fits the compute budget. Measure:
   * maximal three-reserve redemption with the SEAL full walk;
   * maximum account-meta count;
   * several exempt mints in one transaction;
   * adversarial instruction ordering and long instruction data.
   
   Record consumed units from validator logs and establish a margin. Until measured, the confinement repair can be a production redemption or mint halt.

2. **The unlevelled-vault halt is not adequately described as merely “recoverable.”** Recovery is manual and the trigger can recur through every new activation. That is a repeatable liveness attack, reported above.

---

# Verdict challenges

## The statement that the MINT exemption is safe is not established

“A forged instruction wearing those bytes dispatches to the real handler” is true but incomplete. The real handler itself can spend the Bank’s SOL when the Bank occupies `payer`, and the supplied tests already use that account alias. Dispatch authenticity does not imply account-role safety.

## “Confinement closes the harm” is too broad

The new checks prevent a non-exempt top-level instruction from naming the Bank. They do not prevent:

* fee-payer spending;
* spending through permitted roles inside exempt instructions;
* one Bank signature approving several exempt operations;
* the accepted payer roles inside the redemption pair.

The documentation must describe this as top-level instruction-class confinement, not complete confinement of Bank SOL expenditure.

## The new distribution refusal is proven to become a finding, not proven to reach a person

The notification claim requires an end-to-end scheduled-run test with an actual delivery acknowledgement. The supplied diff stops at finding construction.

---

# Anything else

No new CRITICAL loss of customer cbBTC was established from this diff. The highest-confidence defects are:

1. Bank-funded operations remain possible inside exempt mints;
2. one unlevelled activated vault can repeatedly halt all payouts;
3. impossible dates are accepted while the test claims refusal;
4. paid-on-chain human resolutions can fail to reset cadence;
5. the new certification gate checks whole-file substring presence rather than actual table membership.

---

# Given that no human firm will ever see this

Sixteen rounds of AI review cannot supply several external facts the repository needs. Before holding unrestricted customer value, the project should do the following:

1. **Run a capped adversarial mainnet pilot.** Limit aggregate cbBTC and Bank SOL exposure at the custody layer, not by policy. Increase limits only after a fixed observation period with successful real redemptions, distributions, key rotations and incident drills.

2. **Open a public, paid bug bounty before uncapping.** Require executable proofs on a fork or local validator. A bounty is not an audit firm; it introduces economically motivated adversaries who have not been conditioned by sixteen rounds of the same project narrative.

3. **Perform full operational fire drills.** Deliberately:
   * lose the Bank key;
   * compromise the swap operator;
   * corrupt `levels.json`;
   * insert an impossible ledger date;
   * wedge the distribution lock;
   * fail the notification provider;
   * arm an incorrect rotation;
   * redeem a maximal three-reserve vault.
   
   Time detection and recovery using the real production hosts and recipients.

4. **Add mutation testing to the certification.** Automatically mutate:
   * signer constraints;
   * account positions;
   * program IDs and discriminators;
   * table rows;
   * detector severities;
   * date and payment-state branches;
   * base64 validation.
   
   Certification should fail for every security-relevant mutation. Assertion counts do not prove sensitivity.

5. **Create an independently generated transaction corpus.** Do not use only the project’s builders. Generate malformed and adversarial Solana messages from a separate implementation, including duplicate accounts, account aliasing, CPI wrappers, versioned transactions and non-canonical encodings.

6. **Make production behavior observable by external parties.** Publish program hashes, configuration snapshots, pending rotations, distribution ledgers or commitments, and reconciliation outputs in machine-verifiable form. Internal alarms cannot substitute for an external witness when the same operator writes and reconciles the ledger.

7. **Put hard value limits outside the four upgradeable programs.** AI review cannot establish that all future upgrades preserve current invariants. Custody and treasury controls should cap loss from one upgrade, one operator cycle and one signing mistake independently of these programs’ correctness.