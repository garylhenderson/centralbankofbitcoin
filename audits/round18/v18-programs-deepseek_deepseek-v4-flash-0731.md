## Round 18 findings

Scope: the `2c8cd9b..HEAD` diff, focused on R1–R6. No claim below is a re-report of the “Known and open” list unless explicitly marked as worse.

---

### R2 / HIGH — unlevelled activated vault is still a unilateral distribution stop

**Construct.** `bank/distribute.mjs`:

```js
const unlevelled = activated.filter(v => !Object.hasOwn(LEVEL_WEIGHTS, levels[v] ?? ''))
if (unlevelled.length) return { ...empty, refusal: true, skip: ... }
```

`activated` is defined by the vault crossing the 21,000-sat threshold; a missing level then returns a refusal before any payment and `main` finishes the whole day without paying any other vault.

**What the attacker or accident gains.** A single funded vault with no level — or a level register typo — halts payout for *every* activated vault. Round 17 correctly distinguished HALT from QUIET, but the halt remains. The defender says “paying without them overpays everyone else permanently,” which is a coherent fail-closed principle; however it does not stop the DoS. The fix is only operational: a human sees a HIGH detector row and must edit `levels_.json`. Repeated cheap activations can keep the money flow blocked indefinitely.

**Evidence if true.** The new selftest itself creates `"1 activated vault(s) carry no level"` and asserts `distribution_refused` at HIGH. On a live run, one unlevelled, funded vault makes the day’s `paid` object empty.

**Fix.** Do not allow a vault to cross the activation threshold until it has a level assignment. The off-chain level register is already loaded before distribution; require every activated vault in the *same* reader that assigns levels to have a level before the balance threshold is permitted. If the business cannot guarantee that, then an unrecognised vault should get a provisional share held in a pending bucket rather than freezing everyone else.

---

### R2 / MEDIUM — `2026-02-30` is still accepted, and the selftest asserts the bug

**Construct.**  
`holdDays` validates day keys only with:

```js
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
```

`2026-02-30` passes this regex; `Date.parse("2026-02-30")` rolls into March rather than rejecting. The code then calls `dayDiff(anchor, day)`, which returns `173`, a finite number, so the finiteness guard also does not reject it.

The comment says “the two together are what make a rolled-over date impossible to act on,” but no such rejection exists. The selftest confirms the problem:

```js
t('...a shaped-but-impossible date does not produce a confident wrong answer',
  (() => { try { return holdDays({ days: { '2026-02-30': ... } }, '2026-08-22') } catch { return 'REFUSED' } })(), 173)
```

It *expects* `173` — the exact wrong answer the comment says must not happen. This is a live assertion that the bug is correct.

**Attacker / accident gain.** A malformed day key in the ledger (typo, timezone shift, manual edit) silently produces a plausible, finite number of “days held” rather than stopping the job. That can turn a permanent-state computation into a confident but wrong schedule.

**Fix.** After parsing, validate actual calendar components:

```js
const [y,m,d] = key.split("-").map(Number)
const dt = new Date(Date.UTC(y, m-1, d))
const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === m-1 && dt.getUTCDate() === d
```

and use `real` as the `ISO_DAY` test. Then change the selftest to expect `'REFUSED'`.

---

### R3 / MEDIUM — base64 gate still accepts strings that do not stop at “the same transaction”

**Construct.**  
`scripts/bank-sign.sh` now requires length `% 4 == 0` and “padding only at end,” but it does not require canonical base64 at all. In particular:

- `====` passes: all four chars are allowed alphabet/padding; length is 4; there is no `=` inside followed by a non-`=`.  
  `Buffer.from("====", "base64")` returns an empty buffer, not the four-character string pasted.

- Strings with three `=` at the end, e.g. `A===`, are length 4 and pass the same checks. Node may truncate to an empty or one/two-byte result. That is exactly the “shorter transaction” failure the check was written to prevent.

- Non-canonical trailing bits are also accepted. For example, a one-byte base64 final quantum with non-zero trailing bits decodes to a valid one byte but is not the canonical encoding; a strict re-encode-and-compare would reject or use the other bytes.

**Evidence.** Run `node -e "console.log(Buffer.from('====','base64').length)"` — it prints `0`; the shell checks alone will not reject it. Run:

```bash
TX='===='
echo "$TX" | grep -E '^[A-Za-z0-9+/=]+$' && [ $(( ${#TX} % 4 )) -eq 0 ]
```

No complaint. The script also does not reject an empty decoded result.

**Fix.** Replace the hand-rolled checks with a strict canonical re-encode. Decode with `node`, re-encode with `Buffer({ }, 'base64')`, and require the re-encoded string equals the original; also require the decoded message has the expected `solana` transaction envelope length or at least non-empty. A whitespace-stripped, valid 1232-byte transaction’s 1644 chars will survive this.

---

### 4 / LOW — The new “every BankKeyOutside error named in the table” gate is not actually scoped to the table

**Construct.** In `bank/selftest.mjs`:

```js
const errorNames = [...source text.matchAll(#.../]
const bankErrs = [...].filter(n => n.startsWith("BankKeyOutside"))
t("every Bank-confinement refusal the programs can emit is named in the control table",
   bankErrs.filter(n => !spec.src.includes(n)), [])
```

It checks whether the error name appears *anywhere* in the whole `SPEC.md`, not in the control table’s row. A name appearing in free prose would make the test pass even if the control table row is absent.

`tableRows(specSrc)` is already used for the five-row count; the new arm should use the same table-tokenized source, not the entire file.

**Why it is LOW.** Today both `BankKeyOutsidePair` and `BankKeyOutsideMint` are present and the five-row count is tied to them, so the current gate passes. But the gate is not yet doing the work its own comment says it does.

**Fix.**

```js
const tableText = rows.map(row=>row.join(' ')).join('\n')
t(..., bankErrs.filter(n => !tableText.includes(n)), [])
```

---

### R5 — comments

The new comments are mostly the reverse of “strong” now: they correctly deny that the on-chain scan can see the fee payer, and correctly admit that the allowlist is policy. I did not find another residual comment that still claims a false control. The only self-contradictory text is the `2026-02-30` selftest / comment described in R2, which is both a comment and a test.

No additional under-claim appears that is materially stronger than the effect in the code.

---

### R6 — arithmetic

Re-derivation of the supplied schedule figures is correct with weights `{I:2, II:3, III:4, IV:5, V:6}`:

- 108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 732  
- 945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 6405

The five “equal-count” level shares sum to 100% with the same weights: 10 / 15 / 20 / 25 / 30. I could not independently verify the per-$1,000 figures because the actual card text is not included in the provided bundle; the arithmetic used by the two sets of published figures is . Correct on every number that is visible. If the “ten per-$1,000” numbers are from a table not in this diff, re-check them from the same weight formula — do not trust that a table was regenerated because the weight formula changed.

---

### Carry-over list

- `R1` does not need a new report: the fee payer is still invisible on-chain because it is not an account in an instruction, and the off-chain judge is policy; that is still an accepted limit and still not worse than stated unless the off-chain arm contradicts. I could not verify `judgeRedemptionTx` from this bundle, so the fee-payer guard remains unproven, not proven.
- The known “anyone can mint/her level register” DoS is worse than the local process believed. It is not just the fact that a halted distribution is detectable; it remains a low-cost, exturable, hours-to-days denial of a revenue event. I kept this as an independent R2 finding.

---

## What this project should do given that no human firm will ever exist

The structural absence is not “miss more AI findings.” It is that every future change and every future mutated “fix” must be subject to a machine-checkable failure that proves absence of regression, because no traineder is there to catch the forgotten edge. Concretely:

1. **Add fuzz tests as mandatory CI input, not optional quality.** Today the suite is assertion-counted but largely hand-constructed. A `cargo fuzz` harness and a `node --fuzz` for `bis/` string parsers would have caught the base64 issue and the `2026-02-30` issue in minutes. Add a tiny corpus of strings that a solver could miss (empty, over-padded, non-canonical base64, `Date.parse` roller dates, alphanumeric `Object.prototype` keys).

2. **Make each new gate test its own negation.** The SPEC table gate already has a fake `BankKeyNeverMented` negative case. Do the same for every gate: if a future developer deletes the base64 canonicalization or changes `holdDays` to count failed days, the corresponding test must fail before the patch is merged. The only way to make this run is not to rely on a future AI reviewer to check the test against time; it is an automatic `git diff --name` and “no test covers this line” check.

3. **Add a live “signature desk simulation” that withdraws the Bank key is really unnecessary.** Before touching real money, run the exact *production* `scripts/bank-sign.sh` command against a preserved copy of the bank key on a fork with a banks-generated transaction that includes the theft paragraph. A fuzzer will find any remaining bypass faster than yet another reviewer will.

4. **Remove the human “expected” value from the test.** Tests should not call `assertion` with a number that an operator must re-check; they should compute the expected value from the same authoritative constant the program uses. For `holdDays`, compute the calendar date from the ledger date, or by comparing against `Date.parse` of the actual known weekday. When a test contains `173` as a magic number, a human reviewer sees it and thinks it is intentionally checked; an AI reviewer meanwhile sees it and sees an inconsistency. Both leave the wrong value in place.

5. **Take one combination of corpus and produce a “pre-Mainnet packet” every time.** No MATTER whether a bank exists. Build the exact worst-case mint tx and a redemption tx, feed it through a validator with the **actual production programs**, and store the resulting hash as a byte-for-byte gate. That catches object-level account-order changes and instruction-sysvar changes before they ship.

The current worst finding here — the global refusal on an unlevelled vault — is not impossible that a human orderly can recover from, but it is a deliberate, unflagged emergency path that is still present as a DoS. I would not ship new code that adds a new refusal mode without making the refusal itself a forced, non-timeout, monitored **alarm** rather than a detected `st.days` file.

No CRITICAL severity is justified from this diff; the highest is HIGH. That is not comfort — the collection of the defects above is precisely the type of paper-auditing that would go unnoticed until a customer-owned vault is left frozen.