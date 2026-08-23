## R1 — Self-audit repairs

### MEDIUM — `supersede()` only runs when a paying plan proceeds; a repaired refusal that becomes a hold keeps `refused`
**Construct.** `supersede()` is invoked only at `if (!plan.skip && !DRY)`. The skip branch writes `nothingToDo` / optional `refused` / `finishedAt` and never clears a prior `refused`.

**What goes wrong.** Ordering the comments claim to have closed:

1. 09:07 refuses (unlevelled vault) → `refused` + `nothingToDo` + `finishedAt`
2. Operator adds the level and reruns the same day
3. Pool is now under the emission threshold → `plan.skip` is a hold, not a pay
4. Skip path overwrites `nothingToDo`, leaves morning `refused` in place

`detectDistribution` keeps raising `distribution_refused` (“paid nobody”) on a day whose current verdict is a legitimate hold. The documented repair path is “add the missing level, rerun.” That path only silences the HIGH if the rerun **pays**.

Quiet→pay, refuse→pay, pay→crash→resume, two paying runs, and `--dry-run` in between are fine: pay calls `supersede`; resume never should; dry-run does not write.

**Evidence if true.** Ledger after that sequence still has `days[day].refused` while `nothingToDo` starts with `holding:`. `detectDistribution` still emits `distribution_refused`. A unit test that is refuse-then-`decideEmission` hold (no pay) will show the leftover.

**Fix.** On every non-dry write of a new verdict, clear the other verdict flags (or call `supersede` on skip too, then write the new skip marks). Do not special-case “only when money moves.”

### LOW — Manifest porcelain is well-formed; the record is not the bug
`dirty.split('\n').filter(Boolean)` keeps the leading status space (` M foo`). JSON will round-trip. No finding on the record shape.

### R1 template literals (rendered, not guessed)
The prompt I received has **286 / 434 / 93 / 19** in the floors sentence. The only leftover `${FLOORS.onchain}` is the deliberate R1 example. `$CBOB` rendered as `$CBOB`. `${DIFF}` / `${BUNDLE}` were consumed. I do not see another escaped interpolation that should have been a number.

### `isTableRow`
One definition, used by `tableRows`, `tableLines`, the block classifier, and the tamper fixtures. Predicate requires `| **ON-CHAIN|AUTOMATIC|PROCEDURE.**`. A real row that drops the bold or the period fails the new “every `|` line in the block is classified” arm (fail-closed). It will not silently skip a control row that is in the block.

---

## R2 — `bank/distribute.mjs`

### settledAsPayout direction — builder is **not** backwards
`holdDays` larger → `daysSinceLastPayout >= MAX_HOLD_DAYS` sooner → `decideEmission` forces pay. A bare `resolvedBy` (no `resolvedAs: 'paid'`) leaves the clock on the last real signature (52 vs 2 in their fixture) and therefore pays **earlier**. Assuming “resolved ⇒ paid” would shrink `holdDays` and make holders wait. Default is the direction they claimed.

### `paymentState` still blocks re-send
`paymentState` is unchanged: any `resolvedBy` is `'resolved'`. The send loop still `continue`s on `'resolved'`. The SOL-floor outstanding filter uses `paymentState(row) === 'unpaid'`, so resolved rows are not budgeted or retried. `settledAsPayout` is only the cadence reader. That split holds for the callers in this file.

### LOW — Refusal now pages; grief is now a pager (intended, still real)
`plan.refusal` → SMS + `exitCode = 1`, including under `--dry-run` (page suppressed, exit not). Anyone who can activate a vault with no `levels.json` entry already halted every payout; they now also page every 09:07 and turn a `--dry-run` health check red. Charter `price_lamports = 0` makes the vault cheap; 21 000 sats must stay in the vault to keep it activated. The halt was already the product decision. The new cost is operational, not a silent funds leak.

### census serialisation
`census()` builds a null-prototype object then returns `{ ...c }` — a normal `Object`. `JSON.stringify` / ledger read-back / `denominator()` + `Object.hasOwn` are consistent. No consumer in this bundle needs the null prototype.

### Dust bound — re-derived, holds
For each paid vault, `floor(available * w / den)` leaves a fractional part in `[0, 1)`. Sum of those parts is `dust`, so **`dust < activated.length`** whenever `skip == null`.

- Attained at `available = den - 1 = 6404`: every vault gets `w-1`, total `6405 - 2100 = 4305`, dust `6404 - 4305 = 2099 = 2100 - 1`.
- If `available` is too small for 1 sat on the smallest share, `allocateWeighted` skips (`dust = 0`); the bound is not a live payout claim.
- Payment-loop skips (burned mid-run, missing ATA) happen **after** allocation; they do not change allocation dust.

Comment, SPEC gate, and the 2 100-vault assertion agree with the arithmetic.

---

## R3 — `scripts/bank-sign.sh`

No input that passes the new gate should decode to different bytes than the stripped paste: alphabet → padding-only-at-end → `len % 4 == 0` → GNU `base64 -d | base64 -w0` must equal `TX`, then Node sees that same `TX`.

- Whitespace is stripped **before** the round trip; Node gets the stripped string. Wrapped / trailing-newline pastes match (selftest already ran this).
- `$(pipeline) || true` under `set -euo pipefail`: a missing or non-GNU `base64 -w0` yields empty `CANON` ≠ `TX` → refuse. Fail-closed, not fail-open.
- `$(...)` stripping a trailing newline is **load-bearing**: GNU `base64 -w0` still newline-terminates. If someone “fixes” that with a raw read, every legitimate 1644-char (1232-byte) tx will fail. Not a current accept-bad-input bug.
- I do not have a canonical string this script accepts that Node would decode differently.

**Legitimate 1232-byte tx (1644 chars):** `1644 % 4 == 0`; standard padding; round-trip should pass.

**Comment about `ps`:** last line is `exec /usr/bin/env node bank/cosign.mjs --tx "$TX" …`. The tx **is** in the co-signer’s argv / `ps`. It is not in **this** script’s argv. The corrected comment is true.

---

## R4 — `scripts/cron-install.sh`

Jobs actually written:

| tag | line | money as installed (fresh) |
|---|---|---|
| watcher | `bank/alarm.mjs` | no |
| distribute | `bank/distribute.mjs$DIST_DRY` | **yes** — `$DIST_DRY` is empty unless a tagged, uncommented `--dry-run` is preserved |
| revenue | `bank/revenue.mjs$REV_LIVE` | no — `$REV_LIVE` empty unless tagged uncommented `--live` preserved |
| reconcile | `bank/alarm.mjs --reconcile` | no |
| deadman | `notify-gary-sms.sh` | no |

Header + computed “MONEY POSTURE” match those lines. Re-run preserve of uncommented `--dry-run` / `--live` matches `ours()` + `$DIST_DRY` / `$REV_LIVE` interpolation. The header is true for what it states.

---

## R5 — Gates

### `isTableRow` — see R1. Misses non-bold / no-period classifications; the block walk then fails the build.

### MintVault regex — fail-closed
`([\s\S]*?)\n\}` stops at the first newline-brace. A `}` in a doc comment or a mid-struct line-level brace **before** `bank` makes `indexOf('bank') === -1` ≠ `4` (red). After `bank`, the prefix (and index 4) cannot move. Selftest already injects both. Not an open fail.

### `codeOnly` is not a shell parser
`^\s*#` only drops full-line comments. A `#` that is not a comment: `$#`, `${#var}`, quoted `#`, here-doc lines that do not start with `#`. Those stay. The new “exactly one `^\s*exec .*cosign.mjs`” pin is what actually stops a trailing-comment / `echo` first-match replay. Adequate for this file, not generally correct.

### The two `nothingToDo` arms do **not** prove the writer
They prove the detector: unfinished fires without the flag and is silent with it. They do not execute `supersede` / `main()`. The writer is tested in `distribute.mjs --selftest`. The comment “which is why the writer clears it” over-claims what those two `t()` calls show.

---

## R6 — Floors and card arithmetic

**Floors (from `scripts/run-tests.sh`, and they match the copies that are gated):**

- `MIN_ASSERTIONS=286`
- `DET_FLOOR=434` = `selftest.mjs` `FLOOR`
- `ALLOC_FLOOR=93` = `distribute.mjs` `FLOOR`
- `MAINNET_FLOOR=19`

Rendered prompt uses 286 / 434 / 93 / 19. The `run-tests.sh` block in SPEC matches.

**Independent re-derive:**

| | |
|---|---|
| 108·2+60·3+36·4+24·5+12·6 | **732** |
| 945·2+525·3+315·4+210·5+105·6 | **6405** |
| $1k @ 240: 1000·w/732 | 2.73, 4.10, 5.46, 6.83, 8.20 |
| $1k @ 2100: 1000·w/6405 | 0.31, 0.47, 0.62, 0.78, 0.94 |
| share % @ 2100 | 29.5, 24.6, 19.7, 16.4, 9.8 → **100.0** |
| V/I | 6/2 = **3** |
| dust @ 6404 | **2099** |

Card figures are not wrong.

### MEDIUM — SPEC still publishes other stale counts (one-of-N, again)
The gated sentence was updated. These were not:

- `node bank/distribute.mjs --selftest   # 63 allocation assertions` (floor is 93)
- `bank/selftest.mjs (69 assertions)` (floor is 434)
- Ship-gate table: “The 270-assertion suite” (286)

**Evidence:** those strings are in the SPEC.md in this bundle. The selftest only regexes `# (\d+) assertions, real cloned Core`, `(+ (\d+) detector`, `(\d+) allocation and \d+ live-mainnet`.

**Fix.** One source for every published count, or extend the SPEC scrape to every `\d+ assertion` mention.

---

## R7 — One-of-N inside the repairs

- `settledAsPayout` is the only cadence reader in `distribute.mjs`. `paymentState` callers still mean “do not re-send.” That sweep looks right.
- `supersede` on pay-only (R1) is the same shape: the new function is not applied to every write of a day verdict.
- `bankErrs` still names **two** crates (`cbob-vaults`, `cbob-vault-mint`). Title says every `BankKeyOutside*` the programs can emit. BURN/GOV are not scraped. Adding `BankKeyOutsideBurn` would stay green with no table row. Same class as the `#[msg]`-only scrape they just replaced.

---

## Third target — safer than the docs (and one table lie the other way)

### HIGH — Control table still describes the **pre-9d.4** mint exemption
**Construct.** SPEC row “THE BANK'S KEY IS CONFINED…”:

> `cbob-vault-mint` refuses `BankKeyOutsideMint` **outside a `mint_vault`**

**Reality.** After this diff, a `mint_vault` is not a blanket exemption. Bank may appear only at `MINT_IX_BANK_IDX` (4). Bank as `payer` (index 5) is `BankKeyOutsideMint` (test 9d.4). That is the round-18 CRITICAL.

**What a reader loses.** The one table that is supposed to state the guarantee still describes the hole that let `mint_vault(bank, payer=bank)` buy a stranger a vault. Code is safer than the table. This is the owner’s under-claim, still in the table, after the fix.

**Evidence.** Row text vs `if is_mint { require!(a.pubkey != bank \|\| n == MINT_IX_BANK_IDX) }`. Gate `onChainBankPin` only checks `bank: Signer` + `require_keys_eq!`, not the positional walk.

**Fix.** Say: Bank may appear only in the `bank` slot of `mint_vault`, or in no account of any other instruction. Pin that sentence to the same parse that already asserts `MINT_IX_BANK_IDX == indexOf(bank)`.

Known-limit **3** in this prompt is stale the same way (“confinement exempts both approved instructions entirely”). True of open/burn; false of mint.

### HIGH — Same ON-CHAIN row over-claims the owner
Row 1 (classified **ON-CHAIN.**): “The owner must sign too, **and cannot be an off-curve program address**.”

`owner: Signer` is true for a PDA passed as a CPI signer. SPEC’s own DAO section says this, and that the only control is `unredeemable_owner` (AUTOMATIC). The mechanically checked table now states an on-chain impossibility that the programs do not implement.

**Evidence.** `mint_vault` comment + SPEC “A DAO CANNOT HOLD A VAULT” vs table row 1. Suite 5.2 still only tests `isSigner:false`.

**Fix.** Move the off-curve owner sentence to the `detectNestedVaults` AUTOMATIC row. ON-CHAIN: owner must sign. Off-curve: watcher.

### MEDIUM — Table under-names who must sign
“THE BANK MUST SIGN AT ALL” names SEAL + BURN only. MINT also takes `bank: Signer` pinned to config; no vault is created without the Bank. The gate was relaxed to `>= 5` **so a third ON-CHAIN row would not fail the build**, then that row was not added.

---

## Carry-over (only where worse or mis-stated)

- **3 is not worse — it is false for mint.** System is stronger than the accepted limit. Do not keep reprinting it unchanged.
- **12 (CU)** — still unmeasured; mint now walks every top-level ix and does a per-account Bank compare. Already flagged as worse. Still no number.
- **Unlevelled halt** — not on the list; paging (R2) makes the same grief louder. Halt itself is unchanged.
- Others: no new exploitability from this bundle.

---

## Verdict challenges

- “Not resetting pays sooner” — **holds** (trace above). Do not flip the default.
- “Dust max 2 099 is attained” — **holds** at `available = 6404`.
- “`supersede` cannot strip `finishedAt` off a paying day in `main()`” — **holds** (resume / dry-run never call it). The hole is the **skip** path, not the paid path.
- “`DONE_MARKS` is the detector’s suppressor set” — the list matches the scrape; the function **does not apply the list** unless `refused` or `nothingToDo` is already set. That is the incomplete repair.

No CRITICAL I can defend with on-chain or test evidence. I will not invent one.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Sixteen rounds keep finding the same two classes: (1) a fix applied to *n−1* sites, (2) a table/comment that is not the code. AI re-reading diffs will keep doing that. What this process structurally cannot do:

1. **Run the money jobs against a hostile clock.** Spin `distribute.mjs` for real orderings (refuse→hold, quiet→pay→kill -9, human `resolvedBy` then rerun, cron-install after a commented `--dry-run`) on a throwaway ledger and assert the detector output. The suite tests pure functions and greps. It does not test `main()` control flow. That is where R1 still is.

2. **Measure compute units on the worst redemption and the worst mint+confinement walk** on the same cloned-Core validator. Limit 12 has been a paragraph for many rounds. One `solana compute-budget` number in the suite would end it. AI will not produce that number by reading Rust.

3. **Stop generating a new unaudited `auditN.ts` every round.** The certifier is now the largest unfrozen surface (roster, quorum, bundle, interpolations). Freeze the runner. Change roster via a 20-line config, not another 500-line rewrite that then needs a self-audit.

4. **Put one human (Gary, not a firm) on a printed redemption and a printed distribution receipt** before first real cbBTC: one forced 31-day ceiling payout on a 3-vault test census, and one open/sweep/burn that `bank-sign.sh` actually signed. The suite never submits a Bank signature on a cluster that is not the test validator with a test key. That gap is not closable by another model.