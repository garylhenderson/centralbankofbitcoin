## R1 — self-audit repairs

### HIGH — Audit certification is not bound to the recorded commit or a clean tree

**Construct:** `scripts/audit18.ts` and `scripts/audit19.ts`.

The audit input is constructed at module initialization:

```ts
const DIFF=execSync(`cd ${R} && git diff ec7d17e..HEAD ...`)
...
${f('bank/distribute.mjs')}
```

Only later, inside `main()`, the script records:

```ts
const head=execSync('cd '+R+' && git rev-parse HEAD').toString().trim()
const dirty=execSync('cd '+R+' && git status --porcelain -- programs bank scripts tests').toString()
...
if(dirty) console.log(' ... this round did not audit a fixed tree')
```

It does **not** fail when `dirty` is nonempty. It also does not re-check `HEAD` or the worktree after model responses return.

**Impact:** A certification can exit zero while:

1. the full-file portions of the prompt contain uncommitted code;
2. the displayed diff excludes that uncommitted code;
3. the manifest records a committed `head` that does not uniquely identify the audited material;
4. files or `HEAD` change while the eight model requests are in flight.

This is not merely a presentation problem. The artifact can say a specific commit received quorum while some auditors actually reviewed a dirty, non-reproducible tree. Given that this process is the certification authority, that permits an unaudited deployment candidate to acquire a misleading audit receipt.

The current warning is not a gate:

```ts
if(dirty) console.log(' ... this round did not audit a fixed tree')
```

The script can still return success if quorum is met.

**Evidence to check:**

1. Make an uncommitted change to `bank/distribute.mjs`, such as a unique comment or a behavior change.
2. Run `audit19.ts` with a cheap one-model roster.
3. Confirm the model prompt contains the dirty full-file content while `DIFF` does not show it.
4. Confirm `MANIFEST-*.json` records `head` as the committed revision, includes `dirty`, and the process exits zero if quorum is met.
5. Change `HEAD` or a loaded file after prompt construction but before requests complete. There is no post-run consistency failure.

**Fix:**

- Refuse to run if the selected tree is dirty **before** constructing `DIFF` or `PROMPT`.
- Pin a revision once, then load every file and diff through Git at that exact revision, e.g. `git show "$HEAD:path"` and `git diff "$BASE..$HEAD"`.
- Better: create a detached temporary worktree at the pinned revision and build the prompt solely from that worktree.
- Re-check that `HEAD` and selected-path status are unchanged after all requests finish; fail if they changed.
- Put the base revision, audited revision, and a hash of the complete prompt into the manifest.
- Apply this to both `audit18.ts` and `audit19.ts`; this is another one-of-N-site failure. `audit19.ts` added roster verification, but `audit18.ts` remains runnable without it.

---

### LOW — The control-table row recognizer is format-sensitive and not a parser of the claimed table

**Construct:**

```ts
const isTableRow = l =>
  /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

used by:

```ts
const tableRows = src => src.split('\n').filter(isTableRow)...
const tableLines = src => src.split('\n').filter(isTableRow).join('\n')
```

**Impact:** This does not identify a control-table row as such. It identifies any Markdown line beginning with `| ` that happens to contain one of:

```md
**ON-CHAIN.**
**AUTOMATIC.**
**PROCEDURE.**
```

after a pipe.

It will miss a genuine row if the table’s control-status cell changes punctuation, uses a line break, uses an equivalent status formulation, or uses a different but valid Markdown spacing style. Conversely, it can classify an unrelated table row as a control row if prose in another cell contains the matching bold phrase.

The immediate consequence is documentary-gate bypass or false failure, rather than an on-chain bypass. But this gate exists specifically to prevent the control table from drifting from program errors; a format-sensitive heuristic is weaker than its assertion names claim.

**Evidence to check:**

- Add a non-control table elsewhere in `SPEC.md` containing `**ON-CHAIN.**` and a `BankKeyOutsideMint` string. The error-name arm can count that prose table as control-table evidence.
- Change only the formatting of a real control row, for example from `**ON-CHAIN.**` to `**ON-CHAIN**.` or add a line break inside the cell. The row disappears from the parser without changing the documented meaning.

**Fix:** Parse the specifically headed control table by header names and column positions. Require an exact status-cell value from an enumerated set. Assert the expected number of rows and their control identifiers. Do not use a whole-document regex as a surrogate for Markdown table structure.

---

### LOW — The new stale-`nothingToDo` tests demonstrate detector behavior, not that the writer clears the flag

**Construct:** The two new tests in `bank/selftest.mjs` manually call `D.detectDistribution` on fabricated ledger states:

```ts
D.detectDistribution({ days: { ... nothingToDo: ... } }, ...)
```

The test name says:

```ts
'...which is why the writer clears it'
```

but neither test runs `distribute.mjs`, exercises the clearing branch, nor verifies a saved ledger after a quiet-then-pay transition.

**Impact:** The tests prove the precondition for the repair — a stale flag suppresses `distribution_unfinished`. They do not prove the repair itself. A future edit can remove, move, or conditionally bypass:

```ts
delete st.days[day].refused
delete st.days[day].nothingToDo
```

while these tests remain green.

This is a gate-coverage defect, not proof that the present clearing code is wrong.

**Evidence to check:** Temporarily remove both `delete` statements from `distribute.mjs`; the two added detector tests continue to pass.

**Fix:** Extract the day-state transition into a pure helper, or run a controlled integration test that starts with `nothingToDo` / `refused`, proceeds into a payment plan, reloads the ledger, and confirms that:
- both old verdict fields are absent;
- `supersededAt` and `supersededWas` are present;
- a later unfinished payment run triggers `distribution_unfinished`.

---

## R2 — `bank/distribute.mjs`

### MEDIUM — An unlevelled vault is now a durable daily SMS-paging primitive

**Construct:**

```ts
if (plan.refusal) {
  const msg = `CBOB DISTRIBUTION REFUSED and paid nobody: ${plan.skip}`
  console.error(msg)
  if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
  process.exitCode = 1
}
```

combined with the intentional refusal condition:

```ts
if (unlevelled.length) return {
  ...empty,
  refusal: true,
  skip: `${unlevelled.length} activated vault(s) carry no level: ...`
}
```

The repository itself states that an outsider can activate a vault with enough cbBTC and no level.

**Impact:** A stranger can make the daily distribution halt and page the operator every scheduled execution until someone updates the off-chain level register. The new notification behavior converts the already-known payout-halt griefing condition into a persistent paging and alert-fatigue primitive.

The problem is not that the first notification exists. The problem is unbounded repetition from the same unresolved condition. It can make future alerts less actionable, consume SMS quota or operator attention, and create pressure to suppress or ignore the alarm channel.

The `--dry-run` exit behavior is not the issue: it does not notify. The live scheduled path is.

**Evidence to check:**

1. Create or simulate one activated vault absent from `levels.json`.
2. Run live-mode distribution twice on separate dates, without repairing the register.
3. Each run writes a refusal and invokes `NOTIFY`.
4. The state does not record a notification fingerprint, acknowledgement, suppression interval, or escalation state.

**Fix:**

- Notify immediately on a new refusal condition.
- Persist a normalized refusal fingerprint, affected vault IDs/count, first-seen time, and last-notified time.
- Rate-limit repeated notifications for the unchanged condition while retaining a visible unresolved alarm.
- Re-notify only when the affected set changes, after a defined escalation interval, or through a separate escalation policy.
- Do not suppress `distribution_refused`; suppress only duplicate human paging.

---

### No finding — cadence direction and dust bound

The stated cadence direction is correct:

- A bare `resolvedBy` that does **not** count as payout leaves `holdDays` larger.
- `decideEmission()` pays when the threshold is reached, or forcibly pays when:

```ts
daysSinceLastPayout >= maxHoldDays
```

- Therefore a larger `holdDays` can only make the forced-pay condition happen earlier, not later.

The dust claim is also mathematically correct for a non-skipped successful allocation. For each activated vault:

```text
floor(available × weight / denominator)
```

leaves a fractional remainder strictly below one satoshi. Summing fewer than one satoshi over `N` paid vaults gives dust `< N`. It remains true when `available < N`; it remains true regardless of weights; and skipped plans do not distribute or retain allocation dust under this path.

The test coverage is finite and does not constitute the proof, but the underlying bound is valid.

---

## R3 — `scripts/bank-sign.sh`

### No accepted non-canonical base64 input found in the shown path

The round-trip test is materially stronger than the preceding alphabet, placement, and length checks:

```bash
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
if [ "$CANON" != "$TX" ]; then
  ...
fi
```

For GNU/coreutils `base64`, malformed, excess-padding, non-zero trailing-bit, and decode-error cases either re-encode differently or yield an empty/different `CANON`, causing refusal. Embedded whitespace is deliberately removed before validation; that is consistent with the documented acceptance of wrapped input.

The `|| true` does mask decoder failure, but in this construct it does not create acceptance: failure leaves an empty or partial canonical value, and equality with a nonempty valid transaction fails. It would be clearer and less error-prone to capture decoder exit status explicitly, but I cannot substantiate a currently accepted malformed transaction from the supplied code.

The 1,232-byte maximum transaction encodes to 1,644 base64 characters, divisible by four, and is not rejected by the length rule.

The corrected `ps` statement is substantially accurate: the base64 payload is absent from this script’s argv but is present in `cosign.mjs` argv after `exec`.

---

## R4 — `scripts/cron-install.sh`

### LOW — Header and summary incorrectly describe revenue as always installed dormant

**Construct:**

Header:

```text
revenue.mjs opt-IN. Gated by --live; installed WITHOUT it ...
```

Summary:

```text
revenue sweep -> swap -> return -> split. DORMANT: add --live when ready.
...
revenue is the only job this script leaves dormant.
```

But the installer explicitly preserves a prior live revenue cron:

```bash
if grep -q "revenue.mjs --live" <<<"$CUR"; then
  REV_LIVE=' --live'
  echo "NOTE: the existing revenue cron is --live; keeping it."
fi
...
/usr/bin/node bank/revenue.mjs$REV_LIVE
```

**Impact:** On a re-installation, the script can install a live revenue job while its opening documentation and final summary tell the operator that revenue is dormant. This is exactly the category of money-operation documentation error that the changed header was intended to eliminate.

It does not mean a fresh installation unexpectedly enables revenue: on a fresh crontab `REV_LIVE=''`. It means the statement is false for the script’s supported preserve-existing-live path.

**Evidence to check:**

1. Install a crontab containing the tagged revenue line with `bank/revenue.mjs --live`.
2. Re-run `cron-install.sh`.
3. The output says it is preserving live mode.
4. The resulting crontab retains `--live`.
5. The header/final summary still describe revenue as dormant or installed without `--live`.

**Fix:** Make the wording conditional and print the resolved state after installation, for example:

```text
revenue: LIVE (preserved from existing tagged cron)
```

or:

```text
revenue: DORMANT (no --live present)
```

Also have the final verification output grep and display the actual five installed lines, not merely generic prose.

### Installed-job enumeration

As installed from a fresh crontab:

| Job | Installed command behavior | Can move money? |
|---|---|---:|
| watcher | `bank/alarm.mjs` | No direct payment path shown |
| distribute | `bank/distribute.mjs` without `--dry-run` | **Yes**; live cbBTC distribution |
| revenue | `bank/revenue.mjs` without `--live` | No, unless an existing tagged `--live` line is preserved |
| reconcile | `bank/alarm.mjs --reconcile` | No direct payment path shown |
| deadman | notification script | No cbBTC movement; can send SMS/alert traffic |

Thus “installing this arms a live cbBTC sender” is true because of `distribute.mjs`. “Revenue is dormant” is only true for the fresh-install branch, not the preserve-live branch.

---

## R5 — changed gates

### LOW — `MintVault` struct regex can be terminated by valid multi-line Rust attribute expressions

**Construct:**

```ts
const body = (src.match(
  /pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/
) || [])[1] || ''
```

**Impact:** The parser defines the end of the account struct as the first line consisting of `}`. That is not necessarily the struct closing brace. Anchor account attributes can validly contain multi-line Rust expressions or blocks, for example a future constraint of the form:

```rust
#[account(
    constraint = {
        expensive_check(...)
    }
)]
pub bank: Signer<'info>,
```

The `}` ending the constraint block satisfies `\n\}` and terminates the extracted body early.

In many placements this fails closed because the expected first-six-field assertion fails. But it is not a sound source parser, and future formatting changes can turn the asserted bank-index relationship into a parser artifact rather than a property of the compiled account order.

**Evidence to check:** Add a harmless multi-line `constraint = { ... }` attribute before an account field and run `bank/selftest.mjs`. The regex body stops at the attribute’s closing brace rather than the struct close.

**Fix:** Do not parse Rust nesting with a non-greedy regex. Prefer one of:

- emit account-order metadata from the Rust crate and test that output;
- parse with a Rust syntax parser;
- use an Anchor IDL generated from the compiled program and derive the account index from the IDL;
- at minimum, implement brace-depth scanning after locating the struct opening brace.

---

## R6 — counts and arithmetic

The changed floor values agree across the supplied files:

- `scripts/run-tests.sh`: `DET_FLOOR=403`, `ALLOC_FLOOR=63`, `MAINNET_FLOOR=19`.
- `bank/selftest.mjs`: `FLOOR = 403`.
- `bank/distribute.mjs`: `FLOOR = 63`.

`audit19.ts` reads the runner values rather than duplicating them. The supplied diff does not show the `MIN_ASSERTIONS` line, so the stated 284 on-chain floor cannot be independently re-read from the excerpt, but it is dynamically read by the audit script if present.

Arithmetic re-derivation:

- 240-vault denominator:

```text
108×2 + 60×3 + 36×4 + 24×5 + 12×6
= 216 + 180 + 144 + 120 + 72
= 732
```

- 2,100-vault denominator:

```text
945×2 + 525×3 + 315×4 + 210×5 + 105×6
= 1,890 + 1,575 + 1,260 + 1,050 + 630
= 6,405
```

- Per-$1,000 figures are correct to two decimals:

```text
at 732:  2.73, 4.10, 5.46, 6.83, 8.20
at 6405: 0.31, 0.47, 0.62, 0.78, 0.94
```

- The 2,100-vault level shares are correctly rounded:

```text
I   1890 / 6405 = 29.5%
II  1575 / 6405 = 24.6%
III 1260 / 6405 = 19.7%
IV  1050 / 6405 = 16.4%
V    630 / 6405 =  9.8%
                     -----
                    100.0%
```

No arithmetic defect found in the supplied schedule figures.

---

## Carry-over limits that are worse than stated

### HIGH — The “AI certification” runner itself remains an accepted unaudited deployment path unless the clean-tree finding is fixed

This is broader than an ordinary tooling defect because the owner has made the audit runner part of the certification mechanism. The known limitation list discusses model quality, output truncation, roster validity, and audit coverage, but not the fact that the certification artifact can presently identify a committed revision while loading uncommitted source. That is a direct certification-integrity gap, not merely a limitation of AI review.

---

## Verdict challenges

1. **Do not treat a quorum of model prose as a certification of a Git commit until the prompt is reproducibly pinned to that commit.** The current manifest is a receipt of requests, not a cryptographic binding between reports and reviewed source.

2. **The current refusal notification repair needs a repeat-alert policy.** The repair correctly makes a payout halt visible, but it has changed an intentional fail-closed payout halt into an attacker-triggerable persistent human-paging condition.

3. **The documentation repair in `cron-install.sh` is incomplete.** It correctly distinguishes fresh-install distribution from revenue, but it fails to describe the script’s explicit “preserve existing `--live`” branch.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that sixteen rounds of AI audit structurally cannot?

1. **Make the audited artifact reproducible and independently verifiable.**  
   Build from a pinned commit in a clean ephemeral environment; publish source hash, binary hash, deployed ProgramData hash, IDL hash, test logs, and audit-prompt hash. A holder should be able to verify that the deployed programs equal the audited binaries without trusting the machine that ran the audit.

2. **Use strict value caps and staged exposure.**  
   Before unrestricted customer deposits, enforce on-chain and operational caps on:
   - maximum cbBTC redeemable per epoch;
   - maximum distribution per run;
   - maximum revenue sweep;
   - maximum loss from a single key or automation failure.  
   Raise caps only after observed operation over defined periods. AI review cannot substitute for limiting blast radius.

3. **Create an adversarial production-like test environment with real independent operators.**  
   Fund a public test vault system and pay independent participants to attempt:
   - transaction construction against the Bank signer;
   - cron and ledger fault injection;
   - malformed account and indexer responses;
   - alert fatigue and refusal-state attacks;
   - upgrade and configuration-rotation failures.  
   This needs real independent incentives and real operational observation, not more textual model review.

4. **Separate custody and deployment authority from the system author.**  
   Use independently controlled multisigs, hardware-backed signing, distinct operators for upgrades, Bank signing, payout treasury, and incident pause. AI cannot create independence of custody or make a conflicted operator accountable.

5. **Install measurable runtime tripwires.**  
   Continuously reconcile on-chain cbBTC balances, expected distribution liabilities, signer activity, deployed code hashes, and cron execution. Define automatic pause thresholds for unexplained deltas, repeated refusals, repeated notifications, ledger divergence, or unexpected signer use. The evidence must be externally retained and append-only.

6. **Commission a public bounty with executable proof requirements.**  
   Require proof transactions, test cases, or deterministic reproductions for claims. AI can suggest attack hypotheses; it cannot establish that adversaries with incentives failed to exploit the deployed system.