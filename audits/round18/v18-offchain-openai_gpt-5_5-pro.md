## R1 — `mint_vault` Bank-key confinement

### HIGH — Bank-as-fee-payer / priority-fee drain is still live on the mint path unless an external mint signer policy exists

**Construct:** `mint_vault` now confines `cfg.bank` only by walking instruction account lists. The fee payer is not in any instruction account list, and MINT still has no `judgeMintTx` equivalent.

**Gain:** If the Bank signs a mint transaction where `feePayer = bank`, the on-chain confinement will not see that. An attacker can add `ComputeBudgetProgram.setComputeUnitPrice` / `setComputeUnitLimit` instructions with no Bank account metas and burn Bank SOL as fees/priority fees. This is not cbBTC theft, but it can drain the Bank SOL float and deny service.

**Evidence to check:** Build a transaction:

- fee payer = Bank
- instruction 0: high compute unit price/limit
- instruction 1: valid `mint_vault` with Bank only at account index 4 and payer = attacker/customer

Expected if this finding is right: `BankKeyOutsideMint` does **not** fire, because the only instruction account list containing Bank is the mint at index 4; Bank lamports decrease by transaction fees/priority fees.

**Fix:** Acknowledge this as a live policy dependency for **mints**, not just redemptions. Add a sanctioned mint signing/preflight tool that refuses:

- `tx.feePayer === bank`
- excessive compute-unit price/limit
- unexpected programs if the Bank is signing

On-chain cannot fix this; custody/signing policy must.

---

### LOW — `MINT_IX_BANK_IDX = 4` is a new security-critical positional constant and is not visibly pinned to `MintVault<'info>`

**Construct:** `const MINT_IX_BANK_IDX: usize = 4;`

**Gain:** Future account reordering can silently turn the confinement into either a false reject or a false exemption. The discriminator is pinned in tests; this positional constant should be pinned the same way.

**Evidence to check:** Grep for `MINT_IX_BANK_IDX` in tests/selftests. In the provided diff, only the discriminator assertion was added. A test should parse `pub struct MintVault<'info>` and assert that `bank` is field index 4 and `payer` is index 5.

**Fix:** Add a source parser assertion like the existing account-position gates for SEAL/BURN.

---

### LOW — `BankKeyOutsideMint`’s error message is now inaccurate

**Construct:**

```rust
#[msg("the Bank's key appears in an instruction that is not a mint_vault; ...")]
BankKeyOutsideMint
```

The same error is now also emitted when the instruction **is** `mint_vault` but Bank appears in the wrong slot, e.g. payer index 5.

**Gain:** Operator/debugging confusion. The 9d.4 test intentionally rejects “Bank as payer of a mint” with this error, but the message says the instruction was not a mint.

**Evidence to check:** Run 9d.4; the error name is correct, the message text is not.

**Fix:** Change the message to: “the Bank’s key appears outside the bank slot of mint_vault, or in a non-mint instruction.”

---

### LOW — compute cost increased and remains unmeasured

**Construct:** every `mint_vault` invocation walks every top-level instruction. Multiple mints in one transaction each repeat the full scan.

**Gain:** Legitimate batching may fail from compute exhaustion; malicious signing requests can be made expensive or non-landing. This is worse than the already-known “compute units are unmeasured” item.

**Evidence to check:** Simulate maximum-size mint transactions with extra account-heavy instructions and record `unitsConsumed`. Also test multiple mints in one transaction: cost is approximately `mints × top_level_instruction_count`.

**Fix:** Add compute-budget assertions to the validator suite and publish the supported transaction shapes.

---

## R2 — cadence and weighted distribution

### MEDIUM — `resolvedBy` rows do not reset the hold clock, even when the resolution says the transfer landed

**Construct:**

```js
const paid = days.filter(d =>
  Object.values(st.days[d]?.paid || {}).some(r => paymentState(r) === 'paid')
)
```

`paymentState(row)` returns `'resolved'` for `resolvedBy`, never `'paid'`.

**Gain:** A day that actually paid but was later resolved manually does not count as a payout day. The 31-day ceiling can fire too early, changing the cadence and moving cbBTC earlier than intended.

**Evidence to check:**

```js
const real = { paid: { a: { sig: 'S' } } }
const resolvedPaid = {
  paid: { a: { sig: null, resolvedBy: 'gary: found it on chain' } }
}

holdDays({
  days: {
    '2026-07-01': real,
    '2026-08-20': resolvedPaid,
  }
}, '2026-08-22')
```

Current result will be `52`. If that resolution means “the transfer landed”, the correct answer is `2`.

There is a related legacy-shape risk: older tests still use `{ paid: { x: 1 } }` as if it means paid. `paymentState(1)` is not `'paid'`.

**Fix:** Split resolution state:

```js
resolvedAs: 'paid' | 'unpaid' | 'waived'
resolvedSig?: string
```

Then count `paid` and `resolvedAs: 'paid'` in `holdDays`. Also migrate or reject legacy scalar rows explicitly.

---

### HIGH — the unlevelled-vault halt is still an externally triggerable global payout DoS

**Construct:**

```js
const unlevelled = activated.filter(v => !Object.hasOwn(LEVEL_WEIGHTS, levels[v] ?? ''))
if (unlevelled.length) return { ...empty, refusal: true, skip: ... }
```

**Gain:** Anyone who can mint a vault and fund it with 21,000 sats can stop every distribution until the operator updates `levels.json`.

The author’s argument is incomplete. Excluding the vault would overpay others, but halting is not the only recoverable alternative. A conservative non-halting allocator can reserve for unknown vaults at maximum weight V, pay known vaults against `known_denominator + 6 * unknown_count`, and carry the remainder until levels are assigned. That underpays temporarily rather than overpaying permanently.

**Evidence to check:** Mint/fund a vault, omit it from `levels.json`, run `distribute.mjs` with available cbBTC. Expected: no vault is paid; ledger records `refused`.

**Fix options:**

1. assign level before or at mint, before activation is possible;
2. make activation dependent on a level record;
3. use conservative max-weight escrow for unknown levels instead of halting everyone.

---

### MEDIUM — distribution refusals are recorded, but this diff does not prove they page a human

**Construct:** refusal branch:

```js
if (plan.skip) {
  if (!DRY) {
    st.days[day].nothingToDo = plan.skip
    if (plan.refusal) st.days[day].refused = plan.skip
    st.days[day].finishedAt = ...
    save(st)
  }
  return
}
```

No direct `NOTIFY` call is made for `plan.refusal`.

**Gain:** A customer-triggered halt can exit 0 and rely on the separate watcher path. If the watcher misses distribution findings or is down between deadman intervals, the money job itself does not alert.

**Evidence to check:** Grep the skip/refusal branch for `execFileSync(NOTIFY, ...)`: none. Then run an unlevelled-vault refusal and confirm whether SMS is sent immediately or only after `alarm.mjs` later processes the ledger.

**Fix:** On `plan.refusal`, call `notify-gary-sms.sh` directly and/or set a nonzero exit code. Keep the detector too, but do not make it the only alert path.

---

### LOW — prototype-reachable keys still exist in exported arithmetic helpers

**Constructs:**

```js
export function census(levels) {
  const c = {}; ...
  for (const v of Object.values(levels)) if (c[v] !== undefined) c[v] += 1
}

export function denominator(c) {
  return LEVELS.reduce((s, l) => s + (c[l] || 0) * LEVEL_WEIGHTS[l], 0)
}
```

Production `allocateWeighted` now validates levels before calling `census`, so this is not currently a live payout exploit. But the exported helpers still accept inherited keys.

**Evidence to check:**

```js
census({ a: 'constructor' })
denominator(Object.create({ I: 999 }))
```

These should not consult prototypes.

**Fix:** Use `Object.create(null)` for census maps and `Object.hasOwn(c, l)` in `denominator`.

---

### R2 note — invalid ledger day keys

I do not see a customer-controlled path to write top-level `st.days[...]` keys. The script writes those from `today()`. So throwing on invalid day keys is fail-closed against local corruption, not an obvious external grief surface, assuming the ledger file is not writable by another local user. Add a file ownership/mode check for the ledger if it does not already exist elsewhere.

---

## R3 — `scripts/bank-sign.sh` base64 hardening

### LOW — non-canonical base64 is still accepted

**Construct:**

```sh
case "$TX" in
  *=*[!=]*) ... ;;
esac

if [ $(( ${#TX} % 4 )) -ne 0 ]; then ...
fi
```

This enforces “padding only at the end” and length mod 4, but not canonical padding count or zero trailing bits.

**Accepted bad examples:**

- `AAAA====` — extra padding; Node decodes it like shorter canonical input.
- `AB==` — nonzero trailing bits; Node decodes it to the same bytes whose canonical encoding is `AA==`.
- `AAB=` — nonzero trailing bits for a one-padding final quantum; canonical re-encoding differs.

**Evidence to check:**

```sh
TX='AB=='
# shell checks accept it
node -e 'const s=process.argv[1]; const b=Buffer.from(s,"base64"); console.log(b.toString("base64"))' "$TX"
# prints AA==
```

**Gain:** Not a direct signing bypass; the transaction bytes are what Node judges. But the wrapper still accepts malformed input while claiming canonical encoding.

**Fix:** Decode then re-encode and require exact equality:

```sh
node - "$TX" <<'NODE'
const s = process.argv[2]
const b = Buffer.from(s, 'base64')
if (b.toString('base64') !== s) process.exit(1)
NODE
```

A real 1232-byte transaction encoded by standard base64 is 1644 chars and remains accepted.

---

## R4 — gates added this round

### MEDIUM — the `BankKeyOutside*` SPEC gate is not actually a control-table gate

**Construct:**

```js
bankErrs.filter(n => !specSrc.includes(n))
```

This checks whether the error name appears anywhere in SPEC, not whether it appears in the control table.

**Gain:** The exact drift this gate was meant to prevent can survive. A forgotten row passes if the name appears in prose, a footnote, or an unrelated example.

**Evidence to check:** Remove the control-table row for `BankKeyOutsideMint`, leave the string `BankKeyOutsideMint` elsewhere in SPEC, and keep five classified rows by duplicating/adding another row. This arm will pass.

**Fix:** Parse the control table into structured rows and compare the set of control names in that table against the set of emitted `BankKeyOutside*` errors.

---

### MEDIUM — the Rust error regex is narrow and only scans two programs

**Construct:**

```js
/#\[msg\("[^"]*"\)\]\s*(\w+),/g

const bankErrs = [
  'programs/cbob-vaults/src/lib.rs',
  'programs/cbob-vault-mint/src/lib.rs'
].flatMap(errNames)
```

**Misses:**

- a `BankKeyOutside*` variant without `#[msg]`;
- raw-string messages;
- escaped quotes inside the message;
- another attribute/comment between `#[msg]` and the variant;
- a future `BankKeyOutside*` error in BURN or GOV.

**Gain:** A real emitted error can be absent from SPEC and the gate still passes.

**Evidence to check:** Add `BankKeyOutsideBurn` to BURN, or add a no-`#[msg]` `BankKeyOutsideMint2` variant. The gate will not see it.

**Fix:** Use a Rust parser or at minimum scan every `programs/*/src/lib.rs` enum body and match variant names independently of `#[msg]`.

---

### LOW — “exactly two ON-CHAIN rows” is a count, not identity

**Construct:** the selftest checks the number of verified ON-CHAIN rows.

**Gain:** Duplicate rows or wrong-but-counted rows can mask a missing distinct control, depending on how `tableRows()` derives “source says ON-CHAIN”.

**Evidence to check:** Duplicate one verified ON-CHAIN row and remove the other, while ensuring both error names still appear somewhere in SPEC. The count-style assertion is the weak point.

**Fix:** Assert exact identities: e.g. `{BankKeyOutsidePair, BankKeyOutsideMint}` as distinct rows with expected classification.

---

### LOW — signer-set scanner remains blind to `Keypair.fromSeed` and `Keypair.generate`

This was already reported and not fixed. In the provided files, the visible `Keypair.generate` uses are tests/audit scaffolding, not production custody, so I do not see an immediate funds exploit from the shown tree. It is still a certification blind spot: a future production signer using `fromSeed` or `generate` would not be forced into SPEC.

**Fix:** scan for all signer constructors in production paths and either classify or explicitly exclude tests/audit scripts.

---

## R5 — comments and documentation drift

### MEDIUM — `bank-sign.sh` says the transaction is never an argv blob; it is passed as argv

**Construct:**

Comment:

```sh
# THE TRANSACTION IS NEVER AN ARGV BLOB.
```

Code:

```sh
exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ...
```

**Gain:** Local users can see the unsigned transaction in `ps` while `cosign.mjs` runs. This is not Bank-signature theft, but it contradicts the stated privacy/control property.

**Evidence to check:**

Run `scripts/bank-sign.sh tx.b64 --live` and inspect:

```sh
ps -eww -o args | grep 'cosign.mjs --tx'
```

**Fix:** Make `cosign.mjs` accept stdin or a file descriptor, and have the wrapper pipe the already-validated transaction instead of putting it in argv.

---

### MEDIUM — `scripts/audit18.ts` contains mutually contradictory certification claims

**Constructs:**

Top comment says round 17 delivered the bundle to only two of eight auditors and the verdict must not count truncated readers.

Later prompt text says that conclusion was wrong and all eight received the prompt.

**Gain:** The certification process can discard valid auditors or misstate audit coverage. This is exactly the “gate flatters or mismeasures its own margin” failure mode.

**Evidence to check:** Grep in `scripts/audit18.ts` for both:

- `DELIVERED ITS BUNDLE TO ONLY TWO OF EIGHT`
- `That was wrong`

Both are present in the same file.

**Fix:** Delete the false historical block or rewrite it as a corrected incident note. The live script should have one current rule.

---

### MEDIUM — `scripts/audit18.ts` does not fail the round when a model fails or is output-truncated

**Construct:**

```ts
if(j.error) return {model,ok:false,text:`ERROR ...`}
...
await Promise.all(MODELS.map(m => ask(m).then(land)))
```

No final check exits nonzero for `ok:false` or `finish === 'length'`.

**Gain:** A round can silently have fewer auditors than intended while the script exits successfully.

**Evidence to check:**

```sh
MODELS=not/a/real-model node scripts/audit18.ts
echo $?
```

Expected current behavior: writes an error report and exits 0 unless some unrelated exception occurs.

**Fix:** Collect results, write a manifest, and `process.exit(1)` unless the required quorum of successful, non-truncated reports exists.

---

### LOW — stale “equal-per-vault” wording remains

**Constructs:**

- `scripts/audit18.ts` embedded architecture text still says “daily equal payout”.
- `bank/distribute.mjs` resume-plan comment still says “Equal-per-vault is the whole rule”.

**Gain:** Auditors/operators are pointed at the wrong allocation rule after the weighted schedule replaced equal split.

**Evidence to check:** Grep for `equal` in the changed files.

**Fix:** Replace with “weighted by level” or “fixed plan under the weighted rule.”

---

### LOW — assertion counts are underclaimed in the audit prompt

The diff updates floors to:

- on-chain: `284`
- detector/selftest: `395`
- allocation: `56`

But the embedded audit prompt still says `279 / 388 / 45`.

**Gain:** Understates the test coverage and creates another drifting certification fact.

**Fix:** Generate these numbers from the same constants used by `run-tests.sh`, or fail if the prompt literals disagree.

---

### LOW — `cosign.mjs` says Bank confinement is on-chain “in both programs that take the Bank’s signature”

BURN also takes `bank: Signer`. Redemption confinement is enforced by the mandatory preceding SEAL `open_for_redemption`, not by BURN itself.

**Fix:** Say: “Every valid redemption transaction is scanned by SEAL’s mandatory open instruction; MINT scans mint transactions.”

---

## R6 — arithmetic re-derivation

No arithmetic defect found in the published figures.

- 240 census: `108 + 60 + 36 + 24 + 12 = 240`
- denominator:  
  `108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 732`

- 2,100 census: `945 + 525 + 315 + 210 + 105 = 2100`
- denominator:  
  `945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 6405`

Per `$1,000`:

- 240 vaults:  
  I `1000*2/732 = 2.73`  
  II `4.10`  
  III `5.46`  
  IV `6.83`  
  V `8.20`

- 2,100 vaults:  
  I `1000*2/6405 = 0.31`  
  II `0.47`  
  III `0.62`  
  IV `0.78`  
  V `0.94`

Shares at 2,100:

- I: `945*2/6405 = 29.5%`
- II: `525*3/6405 = 24.6%`
- III: `315*4/6405 = 19.7%`
- IV: `210*5/6405 = 16.4%`
- V: `105*6/6405 = 9.8%`

Displayed shares sum to `100.0%`.

---

## Carry-over list — worsened or sharper than stated

1. **Known #1a / fee payer:** worse on the mint path because the only shown fee-payer judge is redemption-specific. MINT now has on-chain Bank-key confinement, but no shown off-chain fee-payer policy artifact.

2. **Known #12 / compute units:** worsened by adding full instruction-sysvar scans to MINT. This needs measurement, not prose.

3. **Known #16 / off-chain level register:** now has an externally triggerable global halt mode. The missing commitment scheme is not only fairness risk; missing/late level assignment is operational DoS.

4. **Known #18 / randomness absent:** the code comments state activation odds and “assigned by fate”, but the code still only reads `levels.json`. That is acceptable only if the launch process makes the assignment artifact independently checkable before activation.

---

## Verdict challenges — underclaims / “safer than docs say”

The main underclaim I found is the stale assertion-count claim: current floors are higher than the audit prompt says. That is not a funds bug, but it is the exact inverse-drift class the owner called out.

I did not find another customer-facing underclaim of the same severity as the old “Bank can be skipped” table wording. Most remaining drift is overclaim or contradiction, especially around base64 canonicality, argv privacy, and equal-vs-weighted payout language.

---

## Anything else

### MEDIUM — `scripts/audit18.ts` does not create `OUT`

**Construct:**

```ts
fs.writeFileSync(`${OUT}/...`, o.text)
```

No `fs.mkdirSync(OUT, { recursive: true })`.

**Gain:** A focused audit run can fail to write reports depending on environment setup.

**Evidence to check:**

```sh
OUTDIR=/tmp/cbob-audit-does-not-exist node scripts/audit18.ts
```

**Fix:** Create the directory before launching model calls, and write a manifest atomically.

---

## Given no human firm will ever see this, do these things next

1. **Replace prose-only AI findings with executable repros.** Every accepted finding should land with a failing test, simulation script, or ledger fixture before the fix is written.

2. **Add property-based fuzzing for Solana transactions.** Generate transactions with duplicate accounts, LUTs, fee-payer variations, compute-budget instructions, malformed sibling instructions, CPI wrappers, and multiple mint/open/burn combinations. Assert the Bank key cannot be charged except in explicitly allowed roles.

3. **Move Bank custody out of raw JSON key files.** Use Squads/HSM/hardware policy that can enforce fee-payer and compute-fee limits independently of this repo. The repository cannot prove what an unrestricted key holder will sign.

4. **Run operational fault drills on staging.** Bad level file, missing level, invalid ledger key, frozen ATA, Helius short page, watcher down, notify script down, model API failure. Require observed SMS/page artifacts, not detector lists.

5. **Launch with hard caps.** Cap Bank SOL balance, daily mint signatures, priority fees, distributor cbBTC exposure, and per-cycle payouts until the system has survived real runs.

6. **Maintain an independent reconciliation implementation.** A second script, preferably in another language, should recompute minted supply, live/burnt vaults, levels, denominator, paid rows, and remaining cbBTC without sharing code with `distribute.mjs`.