## R1 — self-audit repairs

### HIGH — `supersede()` fails to clear `resolvedBy` when it is the only stale completion suppressor

**Exact construct**

```js
export function supersede(rec, nowIso) {
  const was = [rec?.refused, rec?.nothingToDo].filter(Boolean)
  if (!was.length) return { rec, superseded: false, wasRefusal: false, was }
  ...
  for (const mark of DONE_MARKS) delete out[mark]
}
```

`DONE_MARKS` includes `resolvedBy`, but `supersede()` only reaches its clearing loop if `refused` or `nothingToDo` exists.

`detectDistribution` treats a record as unfinished only when, among other conditions:

```js
!rec.finishedAt && !rec.nothingToDo && !rec.resolvedBy
```

**Impact**

A previously manually resolved day can proceed into a new payment attempt while retaining `resolvedBy`. If that attempt then crashes after the durable plan is written but before all transfers are resolved, the stale `resolvedBy` suppresses `distribution_unfinished`.

This recreates the precise fail-open condition the repair was intended to eliminate, through the suppressor that the new `DONE_MARKS` abstraction claims to centralize.

A plausible ordering is:

1. A run creates the day record and encounters an error before a plan is persisted—for example, after persisting a poisoned-ATA report but before reaching the planning write.
2. An operator marks the incomplete day `resolvedBy` to silence or document the prior incident.
3. Conditions are repaired later that day and a new live run reaches:
   ```js
   const sup = supersede(st.days[day], ...)
   ```
4. There is no `refused` or `nothingToDo`, so `supersede()` returns unchanged.
5. The run writes a plan, starts transfers, then dies.
6. Next-day detection sees `resolvedBy` and does not emit `distribution_unfinished`.

The same issue can arise from any pre-existing imported or manually repaired ledger entry containing `resolvedBy` but neither of the two fields used as the early-return condition.

**Evidence if true**

A synthetic record demonstrates it without RPC access:

```js
const rec = {
  startedAt: '2026-08-22T09:07:00Z',
  resolvedBy: 'operator: earlier run abandoned'
};

const s = supersede(rec, '2026-08-22T14:00:00Z');
// Current result: s.superseded === false and s.rec.resolvedBy remains set.

const crashed = {
  ...s.rec,
  plan: { activated: ['v1'], per: { v1: '100' } }
};

// detectDistribution(..., {today: '2026-08-23'})
// should currently omit distribution_unfinished because resolvedBy remains.
```

The existing test for suppressor clearing always injects `refused`:

```js
const rec = { startedAt: 'x', refused: 'r', ... }
```

It therefore cannot prove the early-return path clears every suppressor.

**Fix**

Make supersession eligibility depend on the existence of any detector completion mark, not merely `refused` or `nothingToDo`; then preserve the existing paid-day protection.

For example:

```js
const suppressors = DONE_MARKS.filter(mark => rec?.[mark] !== undefined);
const hasNoPayVerdict = Boolean(rec?.refused || rec?.nothingToDo);
const shouldSupersede = hasNoPayVerdict || suppressors.length > 0;

if (!shouldSupersede) {
  return { rec, superseded: false, wasRefusal: false, was: [] };
}
```

Do not silently discard the prior operator decision: retain it in append-only audit fields such as `supersededResolvedBy` and `supersededAt`.

Add both-direction tests for:

- `resolvedBy` alone followed by a proceeding run and a crash;
- `finishedAt` alone from a quiet prior run;
- a genuinely completed paid day, which must remain non-reopenable;
- `resolvedBy` with a real paid row, which must preserve completion.

---

## R2 — distribution repairs

### No new arithmetic or cadence defect established

The direction of `settledAsPayout()` is correct:

- A bare `resolvedBy` does **not** reset the cadence clock.
- That makes `holdDays` larger.
- Larger `holdDays` reaches `MAX_HOLD_DAYS` sooner.
- At `smallestPer >= 1`, `decideEmission()` therefore forces payment earlier, not later.

The distinction between “settled, do not resend” and “counts as a payout for cadence” is also preserved in the shown payment loop:

```js
if (state === 'resolved') continue
```

A resolved row is not resent regardless of `resolvedAs`.

The dust statement is mathematically sound for a successful allocation. For each activated vault, the floor operation discards a fractional amount in `[0, 1)`, so total dust is strictly below the number of paid/activated vaults. If the pool is too small for every activated vault to receive one satoshi, `allocateWeighted()` returns a skip result with `dust: 0n`; it does not create a settlement contradicting the bound.

The prototype-safe census change also serializes correctly: `{ ...Object.create(null) }` intentionally restores an ordinary object before the census is placed in the ledger.

---

## R3 — `bank-sign.sh`

### No accepted non-canonical base64 input identified from the shown construction

After whitespace normalization, the wrapper requires a byte-for-byte canonical GNU/coreutils round trip:

```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
if [ "$CANON" != "$TX" ]; then
```

Inputs such as `====`, `A===`, `AB==`, `AAB=`, and extra terminal padding re-encode differently and are rejected. A wrapped legitimate input is intentionally normalized before comparison; that is not decoding a different transaction than the normalized pasted base64.

The `|| true` is an availability concern rather than an acceptance bypass: if either base64 stage fails and yields no matching canonical value, the comparison fails closed. On a host without GNU `base64 -w0`, legitimate input will be refused rather than accepted.

The corrected process-list comment is materially true: the base64 transaction is absent from this script’s initial argv but becomes visible in the argv of the eventual `node bank/cosign.mjs --tx "$TX"` process.

---

## R4 — cron installer money claim

The revised header is substantially accurate for the five installed jobs:

| Installed job | As freshly installed | Can it move customer value? |
|---|---:|---|
| `bank/alarm.mjs` watcher | no flag | No cbBTC transfer path shown; monitoring/notification only. |
| `bank/distribute.mjs` | no `--dry-run` | **Yes.** It loads the distributor key and can transfer cbBTC at 09:07. |
| `bank/revenue.mjs` | no `--live` | No, assuming the documented `--live` gate in `revenue.mjs`; its trusted swap path remains dormant. |
| `bank/alarm.mjs --reconcile` | no flag | No transfer path; state reconciliation. |
| deadman notifier | no flag | No cbBTC movement, though it can invoke the SMS notification service. |

On a re-run, the actual posture is conditional because the installer preserves an uncommented tagged `--dry-run` distribution line and an uncommented tagged `--live` revenue line.

The script’s final “MONEY POSTURE AS INSTALLED” output is better authority than the header because it reads the crontab after installation.

---

## R5 — changed gates

### No exploitable MintVault index-parser bypass established

The `MintVault` parser is syntactically brittle:

```js
/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/
```

A line beginning with `}` inside the struct body could truncate it. However, for the position being asserted:

- truncation before `bank` yields index `-1`, which fails the equality assertion;
- truncation after `bank` cannot make `bank` move from index 4;
- a valid Anchor account struct is not expected to contain a standalone closing brace before its actual closing brace.

This is fail-closed for the specific constant, though a real Rust parser or a narrow source-format assertion would be less fragile.

### No shell-comment bypass established in `codeOnly`

```js
const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

A `#` inside a shell quote or parameter expansion is not a shell comment, but this helper only removes lines whose first non-whitespace character is `#`. For ordinary shell syntax, that is a valid comment-line rule. It does not strip trailing comments, but the relevant `exec` matcher is anchored at line start, so a trailing comment mentioning `exec` does not become a candidate.

### Gate weakness: the table grammar is intentionally narrow but fails closed

`isTableRow` requires the exact general shape:

```js
/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/
```

It will not recognize otherwise valid Markdown rows such as `|**control**|...` or rows with a differently formatted classification cell. However, `controlTableBlock()` subsequently rejects any `|` row that fails `isTableRow`, so this is a documentation/build brittleness issue, not a silent omission. A real control row cannot quietly fail to match and remain unchecked under the shown block-level check.

---

## R6 — counts and published arithmetic

### LOW — SPEC’s direct `distribute.mjs --selftest` count is stale and the current gate does not check that occurrence

**Exact construct**

SPEC says:

```text
node bank/distribute.mjs --selftest   # 63 allocation assertions, both directions
```

The source now requires:

```js
const FLOOR = 93
if (R.length !== FLOOR) process.exit(1)
```

and `scripts/run-tests.sh` independently sets:

```bash
ALLOC_FLOOR=93
```

**Impact**

This is a false public and operational claim about the allocation test suite. It undermines the stated “counts move with the suite” discipline and is exactly the kind of customer/operator-facing drift the new floor work claims to prevent.

It is not a direct asset-theft primitive, but it makes an operator reading SPEC believe a direct allocation selftest ran fewer assertions than it actually must run.

**Evidence if true**

Running:

```bash
node bank/distribute.mjs --selftest
```

should report `93/93 allocation assertions as predicted`, or fail because the equality floor enforces 93.

The existing SPEC count gate checks the summary phrase:

```js
num(/(\d+) allocation and \d+ live-mainnet/, spec)
```

It does not inspect the later direct-command claim containing `63`.

**Fix**

Change `63` to `93` in SPEC and add a direct assertion that extracts the command-specific count next to `node bank/distribute.mjs --selftest` and compares it to `ALLOC_FLOOR`.

### Arithmetic re-derivation

The published figures shown are correct:

- 240-vault denominator:

  \[
  108(2)+60(3)+36(4)+24(5)+12(6)
  =216+180+144+120+72=732
  \]

- 2,100-vault denominator:

  \[
  945(2)+525(3)+315(4)+210(5)+105(6)
  =1890+1575+1260+1050+630=6405
  \]

- Per $1,000, at denominator 732:

  - I: \(1000 \cdot 2 / 732 = 2.73\)
  - II: \(4.10\)
  - III: \(5.46\)
  - IV: \(6.83\)
  - V: \(8.20\)

- Per $1,000, at denominator 6,405:

  - I: \(0.31\)
  - II: \(0.47\)
  - III: \(0.62\)
  - IV: \(0.78\)
  - V: \(0.94\)

- Level shares at the 2,100-vault census:

  - I: \(1890/6405=29.5\%\)
  - II: \(1575/6405=24.6\%\)
  - III: \(1260/6405=19.7\%\)
  - IV: \(1050/6405=16.4\%\)
  - V: \(630/6405=9.8\%\)

  Exact shares sum to 100%; rounded one-decimal values also sum to 100.0%.

---

## Carry-over / documentation guarantee challenges

### MEDIUM — SPEC understates the on-chain sweep authorization by calling an operator-signed instruction “permissionless”

**Exact construct**

SPEC’s revenue table says:

```text
| 1. `sweep_sol_for_swap` | **on-chain**, bounded ... | permissionless |
```

SPEC later says:

```text
`split_revenue` is permissionless, so the 50 SOL constant that used to live in
`bank/revenue.mjs` bound nobody: anyone could push the whole balance ...
```

But the actual account constraint is:

```rust
pub struct SweepSolForSwap<'info> {
    ...
    #[account(mut)]
    pub swap_operator: Signer<'info>,
}
```

and the handler enforces:

```rust
require_keys_eq!(
    ctx.accounts.swap_operator.key(),
    cfg.swap_operator,
    MintError::WrongTreasury
);
```

**Impact**

The documentation tells customers and operators that any caller can initiate a sweep. That understates a real on-chain safety property: only the configured swap-operator key can execute it.

This is the same under-claim direction identified by the owner: the system is safer than the document says. It also damages incident response and threat modeling. A reader may conclude an unauthenticated outsider can consume sweep windows or transfer revenue funds, when the code says otherwise.

There is a related internal contradiction: the MINT overview claims `swap_operator` rotation “additionally requires the governance signature,” while the later direction table accurately says rotating `swap_operator` is admin-only today, subject to the timelock. The code’s `needs_governance` expression does not include `swap_operator`.

**Evidence if true**

A transaction invoking `sweep_sol_for_swap` without the configured `swap_operator` as a signer will fail Anchor account validation or the `WrongTreasury` check. A transaction using the correct configured signer can proceed, subject to the cap, cooldown, reserve, and pause checks.

**Fix**

Correct all occurrences consistently:

- `sweep_sol_for_swap`: callable only by the configured `swap_operator` signer; destination is also that configured operator.
- `split_revenue`: permissionless.
- `swap_operator` rotation: admin can arm it; the timelock controls when the rotation takes effect. It does not require governance under the shown implementation.

Add a source-derived documentation gate covering the signer requirement and the `needs_governance` condition. This needs an explicit under-claim check, not merely a test that docs do not overstate controls.

---

## Verdict challenges

1. **Do not claim the stale-suppressor repair is complete.** The `DONE_MARKS` list is centralized, but the early return prevents that list from governing all records. The test proves only records carrying `refused`; it does not prove the broader stated property.

2. **Do not treat exact assertion floors as complete documentation synchronization.** The code floors are mutually synchronized at 286 / 434 / 93 / 19, but SPEC still contains a visible stale `63` allocation count. The new check verifies one summary occurrence, not every count that appears in documentation.

3. **Do not present the sweep threat model as settled while SPEC calls it permissionless.** The code and documentation presently disagree on who can trigger an on-chain SOL sweep. This is not cosmetic: it changes the stated attacker model.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

AI rounds, local-validator tests, and source gates cannot establish several properties that matter more than another textual audit pass:

1. **Deploy with a strict, low-value canary limit.**  
   Do not begin with meaningful customer balances. Enforce a small maximum aggregate cbBTC exposure operationally and on-chain where possible. Expand only after real end-to-end mint, distribution, redemption, recovery, alerting, and rotation exercises have occurred on the deployed binaries and production RPC/provider configuration.

2. **Run adversarial operational drills against the actual production setup.**  
   Test—not merely describe—loss of the distributor key, loss of the Bank key, a disabled cron, an unavailable DAS provider, an unavailable RPC provider, a poisoned ATA, an unresolved transfer, a failed notification provider, a stale lock, and a swap operator that returns no cbBTC. Record measured recovery times and who has authority to act.

3. **Make key custody independently accountable.**  
   The repository cannot prove that the Bank key, distributor key, swap-operator key, upgrade authorities, server account, cron access, and notification credentials are segregated or protected. Put these under distinct accountable custodians, hardware-backed signing where technically compatible, and a documented emergency rotation process exercised before funds arrive.

4. **Publish independently reproducible deployment evidence.**  
   Produce a signed release artifact containing source commit, toolchain digest, program IDs, deployed program hashes, config PDA snapshots, authority addresses, cron artifact, and exact operational settings. Have an entity other than the deployer reproduce the build and compare the deployed bytes and configuration. This is not a conventional audit report; it is an independently checkable release attestation.

5. **Create an external public monitoring surface.**  
   Publish read-only dashboards or signed periodic snapshots for program hashes, config values, pending rotations, revenue balances, sweep events, split events, distributions, and level-register commitments. The operator’s own ledger is not an independent record. Customers need evidence that does not originate solely from the payer.

6. **Fund a real bug bounty and incident reserve before custody.**  
   AI can generate hypotheses and tests; it cannot replace economic adversaries with private exploit knowledge. A standing bounty, disclosed response channel, and precommitted emergency reserve give outsiders a reason and a way to report defects before exploiting them.

7. **Obtain explicit customer-risk consent for the irreducible trusted components.**  
   The off-chain swap, off-chain level register, Bank signing policy, DAS dependence, ledger written by the payer, and Core dependency are not eliminated by more AI review. Customer materials must state those dependencies in concrete loss and delay terms, not as architecture slogans.