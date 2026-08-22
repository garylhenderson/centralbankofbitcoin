# Round 15 audit — findings

Order: R1–R4, carry-over, verdict, then what this process cannot do.

---

## R1. `bank/cosign.mjs` (never audited)

### CRITICAL — The Bank signature is a blank cheque for every other instruction

**Construct.** `judgeRedemptionTx` only constrains SEAL/BURN instructions (exactly one `open_for_redemption`, one `burn_vault`, order, asset/owner/bank pubkeys at hard-coded indices 0/2/3, declared-count, no *extra* SEAL/BURN ix). `inspect()` then `partialSign`s that exact customer-built message.

A Solana signature authorises **every** instruction in the message. The customer composes the message.

What this tool **will** put the Bank’s name on, if the pair looks right:

| Dimension | Behaviour |
|---|---|
| Extra ixs to System, Token, Token-2022, ATA, Core, Stake, ComputeBudget, BPF loader, Jupiter, arbitrary programs | **Blessed.** Only extra SEAL/BURN is refused. |
| Bank as `from` / owner / nonce authority / fee payer on those ixs | **Blessed.** `isSigner` flags are never read. |
| Fee payer | Unchecked. Customer may set it to the Bank. |
| Signer set | Unchecked beyond “Bank pubkey appears at account[3] of open and burn”. |
| Address lookup tables | Legacy only: `Transaction.from` cannot parse v0. **Fail closed** for ALTs. |
| Transaction version | Legacy only. v0 throws in `inspect`, exit 9. **Fail closed.** |
| Two redemptions | Refused. Programs allow it; customer sends two txs. Does not break a required path. |

**Attack.** Redeeming customer (or anyone who can get a well-formed pair into this tool) adds, in the same legacy tx:

```text
open_for_redemption
…honest sweeps…
burn_vault
SystemProgram.transfer({ from: BANK, to: ATTACKER, lamports: <all Bank SOL> })
```

or `spl-token` `Transfer`/`Approve`/`CloseAccount`/`SetAuthority` with the Bank as owner, or `AdvanceNonce` if the Bank is a nonce authority.

`inspect()` returns `ok`. `--live` `partialSign`s. Owner signs and submits. The redemption **succeeds** (extra ixs after a successful burn are legal). The Bank’s SOL/tokens leave in the same atomic transaction.

**Evidence that would exist if this is true**

1. Read `judgeRedemptionTx`: the only loop over “other” ixs is `programId === sealProgram || programId === burnProgram`.
2. Selftest: `t('a well-formed redemption is ACCEPTED', j([mkOpen(), mkBurn()]).ok, true)` — no case with a System/Token ix; extra-SEAL is tested, extra-System is not.
3. **Measure:** build the suite’s 4.2 redemption, append `SystemProgram.transfer` from the Bank key used as `--live`, run `node bank/cosign.mjs --tx …` (inspect-only first). Expect `ok` / “every holding this scan can see is declared”. That is the false bless.
4. On a local validator, `--live` + submit: Bank lamports drop and the vault still burns.

**Fix.** After shape+coverage:

- Allowlist top-level program IDs (SEAL, BURN, Core, Token, Token-2022, ATA, System, ComputeBudget).
- Refuse any instruction that lists the Bank pubkey with `isSigner: true` except the open and the burn.
- Refuse the Bank as fee payer, or require fee payer ∈ {owner, a dedicated fee wallet}.
- Refuse System/Token ixs whose source/owner is the Bank.
- Simulate (`simulateTransaction`) before `--live` and refuse on unexpected debits of the Bank.

This is the control the last five rounds claimed existed. As written it makes the sentence “the Bank sees the whole transaction and must refuse” true of *shape* and false of *authorisation*.

---

### HIGH — `scanPda` discards holdings that the RPC *did* return

**Construct.** Two independent mis-reads of a successful response (not the known airdrop race).

**1. Amount `=== '0'` is dropped.**

```javascript
const amount = account.data.readBigUInt64LE(64).toString()
if (amount !== '0') owned.push(...)
```

Token-2022 confidential / withheld / extension value lives *outside* the base `amount`. Base `amount` is 0. The account is omitted from `owned`. `judgeRedemptionCoverage` passes. `burn_vault` only inspects *declared* remaining accounts; an undeclared T22 account is the documented on-chain hole. The co-signer was the thing that was supposed to see it.

Same class: any token account whose economic value is not in `u64 @ 64`.

**2. DAS `getAssetsByOwner` with no `tokenType` filter.**

Every non-`burnt` `items[].id` is pushed as `kind: 'asset'`. Helius DAS, unfiltered, commonly returns fungibles with `id` = **mint**, not the token account. The burn declares ATAs. Coverage then refuses a legitimate cbBTC vault (“a Core ASSET at \<cbBTC mint\> is NOT declared”). Alternatively, if a provider returns a truncated `items` without `j.error` and without `length >= 1000` (empty `result`, omitted `items`, `total > items.length` with a short page), NFTs are silently treated as absent.

Burnt items are skipped (fine). `j.error` throws (fail closed). The `length >= 1000` guard is the right guard for *that* truncation mode. It is **not** the only way the call fails to answer: HTTP 200 + empty/partial `result` without `error`, indexer lag, and a `total` that disagrees with `items.length` are all unsigned.

**Evidence**

1. Confidential: create a T22 confidential account owned by a vault PDA with withheld tokens; `getTokenAccountsByOwner` returns it; `data.readBigUInt64LE(64) === 0n`; `scanPda` omits it. Unit-test by feeding `owned` that the scan would have built.
2. DAS: `curl` the same `getAssetsByOwner` body against `HELIUS_RPC_URL` for a wallet that holds one NFT and one SPL token. If a fungible `id` equals the mint, every activated vault is refused. If `result.items` can be `[]` while `result.total > 0`, that is a fail-open path.
3. Selftest never calls `scanPda`. The 20 assertions are pure judges with synthetic `owned`.

**Fix.** Treat any token account whose data length ≠ 165 as owned, regardless of base amount. Pass DAS `tokenType: 'nonFungible'` (or drop anything with a fungible interface). Refuse if `result` is missing, or `total` > `items.length`. Test `scanPda` against fixtures of real RPC payloads.

---

### HIGH — Assertions do not cover the hostile surface

`judgeRedemptionTx` / `judgeRedemptionCoverage` are tested both ways for the cases the author thought of. They do **not** cover:

- Extra instruction to any program other than SEAL (extra BURN is coded, not asserted).
- Extra System/Token/Core ix (the CRITICAL above).
- `isSigner` / `isWritable` / fee payer / nonce / compute-budget.
- Versioned tx / ALTs (parse-fail is untested).
- `scanPda`, `inspect()`, `--live`, key-vs-chain, second `Transaction.from`.
- `--selftest` on `cosign.mjs` **does not run any assertion**; it prints a pointer and returns. The header claims “the judgement, both ways”.
- SEAL `bank` vs BURN `bank` disagreement (see below).
- Coverage when DAS ids are mints.
- `BURN_FIXED_ACCOUNTS` drift (see below).

**Evidence.** Read `bank/selftest.mjs` from “the Bank's pre-signature judgement” through the coverage block; grep `scanPda` / `inspect` — no hits. Run `node bank/cosign.mjs --selftest` — no `ok`/`XX` lines.

**Fix.** Drive `inspect()` with serialized real `Transaction` objects, including the drain shape, a v0 tx, a T22-extension account, and a DAS fixture with `total !== items.length`. Make `--selftest` exec `selftest.mjs` or delete the flag.

---

### MEDIUM — `BURN_FIXED_ACCOUNTS = 11` and indices 0/2/3 are uncoupled mirrors

**Construct.** Comment says if BURN’s account list changes, “SEAL's forward match would break first, which fails closed.” That is true **on-chain** (pairing refuses, vault stays sealed). It is not true of **this tool’s coverage set**.

- Constant **too small**: `declared` includes fixed accounts (system program, Core, …). Coverage is `owned ⊆ declared`; extra junk does not hide a missing ATA. `stated !== declared.length` usually fires. Fail closed.
- Constant **too large**: `declared` drops the first remaining accounts. If those are the only valued ATAs, coverage refuses. Fail closed.
- Indices 0/2/3 drift on **open** while BURN stays put: the tool binds the wrong asset, scans the wrong PDA, and can bless a burn of vault A after scanning vault B’s empty PDA.

On-chain pairing still binds the real accounts. The failure mode is **signing a destruction whose completeness scan looked at the wrong PDA**, i.e. the airdrop/nesting check runs on the wrong set.

**Evidence.** Change `BURN_FIXED_ACCOUNTS` to 10 in a unit test; look at `declared` for a 2-ATA burn. Change open’s owner index in a fixture; confirm `shape.owner` / scanned PDA move. No selftest pins `11` to BURN’s `BurnVault` field count (suite 3.1c–f pins SEAL↔BURN *on-chain* indices, not this JS constant).

**Fix.** Export account-list length from one table; assert `BURN_FIXED_ACCOUNTS ===` that table in `selftest.mjs`. Fail `inspect` if `open.accounts.length` / `burn.accounts.length` are below the expected fixed sizes.

---

### MEDIUM — Co-signer reads SEAL’s `bank` only; BURN has its own

**Construct.** `inspect` pins SEAL `Config` and takes bytes `[73,105)`. `--live` requires the keyfile to match **that** pubkey. BURN’s `BurnConfig.bank` is never read. On-chain, `burn_vault` requires `bank == BURN config.bank` and then `WiringDiverged` if SEAL’s copy disagrees.

If the two configs disagree (independent notice periods, one `apply_pending` landed), the tool either:

- signs SEAL’s bank → BURN rejects (`NotTheBank` / `WiringDiverged`), or
- refuses the keyfile if someone already rotated the key to BURN’s bank.

**Fail closed for funds.** Operational halt of every redemption until both applies land and the keyfile matches SEAL.

**Evidence.** Read `cosign.mjs` (one `pinnedAccountData` on SEAL). Read BURN `burn_vault` wiring block (`OFF_BANK` on `seal_config` vs `cfg.bank`). No test with `seal.bank ≠ burn.bank`.

**Fix.** Read both configs; refuse to sign if they differ. Do not treat SEAL as a proxy for BURN during a rotation window.

---

### LOW — Two redemptions in one tx

Refusing is correct for a signer. The programs still allow `open A … burn A, open B … burn B`. Nothing legitimate *requires* one tx. Not a fault.

---

## R2. `bank/lock.mjs` break rewrite

### HIGH — Rename is exclusive for two racers on one stale lock. The restore path is not exclusive for three.

**Two racers, same stale S**

Both pass the re-read. `rename(S → .breaking.<token>)` is one-winner: loser gets `ENOENT` / `lostRace`. Winner checks token, `claim`s. This **does** close the round-14 interleaving (A unlinks, B unlinks A’s fresh lock). Measured by the existing two-racer tests plus the kernel’s rename semantics.

**Three racers — restore window**

`file` is **absent** between a successful `rename` and the `wx` restore / `claim`.

```
A re-read stale S
D breaks S, claim() → D HOLDS, starts paying          // replacement
A rename(file → stolen)     // takes D’s LIVE lock; file is gone
E claim(file)               // file absent → E HOLDS, starts paying
A reads stolen, token≠S, open(file,'wx') → EEXIST, swallows, unlinks stolen
A returns lostRace
D and E are both in withLock(fn)
```

D’s lock bytes were deleted (`unlinkSync(stolen)`). `releaseLock` on ENOENT **returns true** (`catch (e) { return e.code === 'ENOENT' }`), so if D finishes it believes it released cleanly while E still pays — or both pay at once.

The author wrote the `wx` restore specifically so a third process is not clobbered. That acknowledges E. It does not acknowledge that **D is still running**.

**Two-process restore is fine** (A puts D’s bytes back; D still holds). The bug needs the third claimer in the hole the rename opens.

**Evidence**

1. Compose `_beforeSteal` (replacement claimer D) **and** `_afterUnlink` (third `acquireLock` / `claim`). Expect **two** `ok: true` or one `ok` plus a live payer whose file is gone.
2. The new selftest only uses `_beforeSteal`, then asserts D’s token is back. It never runs a claim in `_afterUnlink` during a *mismatched* steal.
3. The “no `.breaking.` litter” assertion is vacuous (below).

**Fix.** Do not use a break-by-rename. `flock`/`fcntl` on an open fd, as the header already names. If you keep rename: after taking `stolen`, **do not** leave `file` absent — the only safe restore is a `link(stolen, file)` that fails on EEXIST, and the stolen-from process must treat a missing file with its token as “you no longer hold” and **stop paying** (compare token on every ledger write). Swallowing `wx` failure is how D and E both proceed.

---

### HIGH — What is built is a narrowing; the header claims a close

**Construct.**

> “ROUND 14 CLOSED THE TOCTOU THIS PARAGRAPH USED TO ADMIT.”
> “Exactly one process can ever take the lock out of the way, and it is the same process that then claims it.”

Sentence 1 is true of the *old* unlink TOCTOU. Sentence 2 is false on the restore path: the process that took the lock out of the way then **puts it back and does not claim**, and another process can claim in the gap.

The next paragraph still says the durable answer is an OS lease and was “recorded as the next step rather than half-built.” That part is honest. The “CLOSED THE TOCTOU” / “same process that then claims it” lines are not.

**Evidence.** The three-racer interleaving above. No production `flock`.

**Fix.** Change the header to “narrowed the two-racer unlink; restore is still a hole; flock is still the answer.” Or implement flock and delete the break.

---

### MEDIUM — `releaseLock` treats a missing file as success

**Construct.** `releaseLock`: `readFileSync` ENOENT → `return true`. After a steal, the victim’s `withLock` `finally` sees a successful release. Combined with the three-racer hole, the victim exits 0 while another runner holds, or while nobody holds and a stale `.breaking.*` is the only copy of the token.

**Evidence.** `catch (e) { return e.code === 'ENOENT' }`. After `_beforeSteal` + rename, call `releaseLock(L, d.token)` before restore; it returns `true`.

**Fix.** ENOENT is “you do not hold.” Return `false` so `finally` prints the existing WARNING and callers can abort the payment loop.

---

### LOW — `readLedger` / `writeLedger` / marker / `withLock` finally

Marker-before-rename and “missing+marker ⇒ refuse” are unchanged and still the right shape. They do not double-pay by themselves. They do not save you if two processes both entered `fn`. No new finding beyond the break.

The new “no temp file” test:

```javascript
fsx.readdirSync(fsx.existsSync(L) ? '.' : '.').filter(x => x.includes('.breaking.'))
```

`L` is under `TMPDIR`. `readdirSync('.')` is cwd. The assertion cannot see `${L}.breaking.*`. It always passes.

---

## R3. Round-14 repairs

### MEDIUM — `applyAcks` can mute the detectors the project exists to keep loud

**Construct.** Key is `<kind>:<asset>`. Any kind that carries an `asset` is eligible. Reason must be a non-empty string. Absent/broken file acks nothing (correct; fail closed for mute). Report prints the count (good).

What it **can** silence that it should not:

- `vault_left_index:<asset>`, `vault_burned:<asset>`, `approve:<asset>`, `undeclared_token_account:<asset>`, `unledgered_sweep` (no asset — **cannot** ack; stays loud).
- `applyAcks` runs **after** `correlateBurns`. A standing ack `vault_burned:<id>` downgrades a later **bare** Core burn of that id to INFO. (A burned address is not remintable — measured 9.12/9.13 — so this is mostly “ack written before the burn, or ack of a live id.”)
- No allowlist of kinds. The comment says acks are for `vault_owns_itself` / burnt-host nest / permanent DAO owner. The code does not enforce that.
- Host-writable `acks.json` is a mute button for every per-asset CRITICAL. Same uid as the Bank key, so this is not a new remote attacker — it *is* a one-file way to stop paging without deleting findings, which is the failure mode the comment describes and then implements.

What it **cannot** silence that an operator might need to: anything without `asset` (`scan_gap`, `config_drift`, `index_disagrees_with_chain`, `watchdog_gap`). Those will page forever. Operational, not theft.

`<kind>:<asset>` is the right *granularity* (one nest ≠ next nest ≠ approve on same asset). It is the wrong *allowlist*.

**Evidence.** `applyAcks` has no kind check. Selftest asserts kind/asset isolation and mandatory reason; it never asserts that `vault_left_index` / `approve` cannot be acked. Write `{"vault_left_index:V":"x"}` and pass a CRITICAL `vault_left_index` — severity becomes INFO, `report`’s `urgent` drops, no SMS.

**Fix.** Allowlist kinds that may be acked. Require `who`/`why`/`when` as structured fields. Refuse unknown kinds at `parseAcks` (problem ≠ null ⇒ ack nothing, already the broken-file path).

---

### MEDIUM — `unredeemable_owner`: false positives stated; one false-negative class is real

**False positives.** Marketplace escrow (stated). Any temporary off-curve holder. Author accepted paging until delist. Nothing minted ⇒ zero today. Not worse than stated.

**False negatives.**

- On-curve smart wallet / relayer (stated; same as Bank).
- `isOnCurve` throw ⇒ `ok === null` ⇒ skip. Unreadable is not a verdict (correct).
- DAS `owner: null` ⇒ skip.
- **A vault owned by an on-curve key that will only ever be used through a CPI wrapper** — identical halt, looks like a wallet.

**Marketplace.** If Core markets use a transfer delegate, owner stays the seller → no FP. If they escrow, FP until delist. Stated.

Not worse than stated. Detection is still the whole control; MINT `owner: Signer` still does not prevent a Squads CPI mint (comment still says “strictly stronger”; still false — carry-over 7).

---

### LOW — `REDEMPTION_NOISE` allowlist is not too wide; the test names a kind that does not exist

Allowlist: `vault_burned`, `vault_vanished`, `deactivated`, `reserve_fell`. Selftest asserts `nested_vault`, `undeclared_token_account`, `vault_left_index` stay CRITICAL. Real `detectApprovals` kind is **`approve`**, not `approve_by_vault_pda`. The fake kind is also not in the allowlist, so the test cannot go green if someone adds `approve` to `REDEMPTION_NOISE`… wait: it also cannot go red if they add `approve` and not the typo. The allowlist is correct; the regression test is not wired to the real kind.

A bare Core `BurnV1` still cannot be laundered: failed txs are skipped (`if (s.err) continue`), so a failing `burn_vault` does not produce `burn_via_program`. Per-asset set. Unchanged.

**Fix.** Assert on `kind: 'approve'`.

---

### `validate-core-gate.sh`

The two round-14 bugs (exit 0 on “FALSE PASS”, `CACHE=/tmp/...`) are actually gone: `set -euo pipefail`, `must_fire`/`must_pass` call `die`, default CACHE matches `run-tests.sh`. ARM 3 correctly reuses ARM 2’s Core-loaded validator.

Residual: `gate()` is still a **copy** of `run-tests.sh`’s logic, not a sourced function. Drift will not fail this script. LOW. Not a ship-blocker.

---

### Ceiling 9.14 / 9.14a / 9.14b

Comparing `fits` to itself is gone. `EXPECTED_CEILING = 3`, bytes pinned at `1119`, ATA-create case pinned at 2. 9.13a pins unsigned-vs-signed size.

If a client **ignores** “create destination ATAs in a prior tx”: the 3-mint tx will not serialize inside 1232. Redemption fails; vault stays sealed. **Fail closed.** Not exploitable for theft. Insufficient as a *product* requirement unless a client implements it; sufficient as a safety property.

Unmeasured CUs remain (carry-over 2). A third signer (payer ≠ owner ≠ bank) adds 64 bytes: 1119+64=1183, still under 1232. State that in the harness or pin a 3-signer serialization.

---

### Floors

Internal `FLOOR = 275` and `DET_FLOOR=275` now match the claimed count. Deleting assertions without replacing the count fails both direct `node bank/selftest.mjs` and the runner. Defeat remains: replace real tests with 275 `t('x',1,1)`. That is inherent to a count floor.

New I/O (`scanPda`, `inspect`, rename restore with three processes) is **outside** the 275. The floor can stay green while the new control is untested. That is the same class as “floor 26 below reality,” relocated to *coverage of new code* rather than *count*.

---

## R4. Comments that claim a control that does not run — or deny one that now does

The rule was: point at SPEC’s table; do not restate. `cosign.mjs` now exists, so **denial** is the same defect.

| Location | Claim | Reality |
|---|---|---|
| **SEAL** `programs/cbob-vaults/src/lib.rs` module header | “**NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it signs, because nothing signs.” | `bank/cosign.mjs` exists and is in SPEC’s table. |
| **BURN** header (paragraph above the SPEC pointer) | “**no Bank co-signing tool exists in this repository**, so nothing scans before it signs.” | Same. The *next* paragraph was updated to point at SPEC; this one was not. One-of-two-sites, again. |
| **SPEC** proven impossibility 2 | Gap is covered by “two post-hoc detectors and, explicitly, **NOT the Bank co-signature, because nothing in this repository signs a redemption**.” | Contradicts the control table two sections away, which lists `bank/cosign.mjs` as pre-signature. |
| **BURN** `burn_vault` rustdoc | Bank “**must SCAN THE PDA BEFORE IT SIGNS** and alarm on every call.” | Scan runs only if a human invokes `cosign.mjs --live`. Not automatic on `partialSign` from any other path; default is inspect-only. Over-claim. |
| **MINT** `MintVault.owner` | “Requiring a SIGNATURE is … **strictly stronger**” than on-curve. | Still false (`is_signer` is true for a CPI-signed PDA). Carry-over 7, still in tree. |
| **`cosign.mjs --selftest`** | “the judgement, both ways” | Prints two lines and returns. |
| **`correlateBurns`** | “self-correcting: the next pass sees both” | Next pass may downgrade; it does **not** retract a CRITICAL already emailed. Carry-over 1, still written as a property. |
| **`lock.mjs`** | “CLOSED THE TOCTOU”; “same process that then claims it” | See R2. |

SEAL `Config.reserve_mints` and BURN’s emptiness “WHAT COVERS THAT GAP” paragraphs correctly point at SPEC. The module headers were left on the old denial.

**Evidence.** `grep -n 'NO CO-SIGNING\|nothing in this repository signs\|strictly stronger\|self-correcting' programs bank SPEC.md`.

**Fix.** Delete the denials. One sentence: “see SPEC.md, THE SHIP GATE / control table.” Fix MINT’s “strictly stronger” in the same edit.

---

## Carry-over — worse, exploitable, or unchanged

1. **Cross-pass correlation lag.** Unchanged. Nothing retracts a sent CRITICAL. Cosign does not feed the alarm. The “self-correcting” comment is still false. Not newly exploitable.

2. **CUs unmeasured.** Unchanged. A CU ceiling below 1.4M on the 1119-byte 3-mint path would strand redemptions the byte cap says are legal. Still the second kill switch. Measure `simulateTransaction` units on the 9.14 fixture before ship.

3. **`prog.*.hash` offset 45.** Unchanged. Wrong when ProgramData has no authority (ELF at 13). Core today has an authority, so Core’s hash is the ELF. If Core is frozen, the watch hashes the wrong slice and can miss a byte change or false-drift. Pre-existing; now includes Core.

4. **Foreign nested Core asset.** Alarm still blind. **Cosign’s DAS `getAssetsByOwner` on the PDA would see it** (if DAS returns it as an item). Gap is narrower at redemption time than the carry-over text says; the alarm gap is unchanged.

5. **`burn_via_program` asset is accounts[0].** Unchanged. Failed txs are skipped, so a fake asset in a failing ix does not launder. Still a sloppy key.

6. **SPEC vs implementation on sweep.** Still contradictory: revenue table says `sweep_sol_for_swap` is **permissionless**; the instruction requires `swap_operator: Signer`. “Running the tests” still cites 178 / 93 / 14. Stale. Not exploitable; it is how the next auditor files a ghost CRITICAL.

7. **MINT dead redemption stamp + “strictly stronger”.** Unchanged and still wrong. A Squads treasury can still mint a permanently sealed vault.

8. **Distribution reconciles the payer’s own ledger.** Unchanged. Still the trusted-hop shape on the 85%.

9. **Duplicate attribute keys; vote during proposal; no atomic reserve continuity.** Unchanged stated limits.

---

## Verdict challenges

### Admin exemption from `detectBankIsNotSignable`

Checked every admin-gated instruction in all four programs: SEAL/BURN `update_config` / `cancel_pending`; MINT `update_wiring`, `set_paused`, `cancel_pending_*`, `set_collection_royalties`; GOV `update_gov_config` / `cancel_pending_admin`. None walk the instructions sysvar. All are a single top-level call with `admin: Signer` (or no admin). A Squads vault CPI-signs them.

`set_collection_royalties` also needs **governance** as Signer; after governance is the GOV PDA that path is already dead (suite 7.18). That is not an admin-as-PDA break.

**None breaks under a PDA admin.** The exemption is correct. Do not “fix” it.

### Closed-ATA delegate ALLOW (3.3a)

A delegate on a closed account is gone; a recreated ATA has no delegate; the PDA cannot sign after burn. Safe. Agree.

### “Only TWO reserve mints if destination ATAs are created in-tx”

The written requirement is sufficient **for safety**: ignore it and the tx does not fit; funds stay sealed. It is not sufficient **for a customer who only has one client that folds ATA creation in**. That is an availability brick at 3 mints, not a theft. Put the prior-tx create in the only redemption client you will ship, or the requirement is a comment.

### If one of round 14’s seven fixes is wrong

**Fix 5 (comments point at SPEC)** was applied to two of three sites. SEAL header, BURN header, and SPEC impossibility 2 still deny the co-signer that fix 1 of *this* round added. Same class, eighth round.

**Fix 7 (9.14)** is now a real gate. Not wrong.

**The lock “fix” (this round, not 14)** is the highest-value wrong fix: it closes the interleaving three auditors wrote down and opens a three-process restore hole the new test does not execute.

**Acks (fix 4)** do what they say, and they will also mute `vault_left_index` if asked. The first `readAcks` bug is actually gone.

---

## Other

- **`scripts/audit-coverage.sh`** is the right measurement. It will fail this freeze until `cosign.mjs` appears in an `f('…')` list. That is the script working.
- Verdict “250 detector” vs `FLOOR = 275` is internally inconsistent. Harmless if the suite really prints 275/275; the verdict is just wrong.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Fifteen rounds of the same prompt shape will keep producing: (a) comment drift, (b) a fix on N−1 of N sites, (c) a selftest that certifies the happy interleaving and not the one that pays twice, (d) CRITICAL claims about sysvars and Borsh that waste a week.

What this process structurally cannot do, and what to do instead:

1. **Execute the hostile customer tx against the new signer.** One `tsx` file: build 4.2, append `SystemProgram.transfer` from the Bank, run `inspect()`, assert `ok === false`. Until that assertion exists, the co-signer is uncertified. AI will keep arguing about it.

2. **Stop breaking locks.** Implement `flock`/`fcntl` and delete `acquireLock`’s steal path. Another round of rename/link/wx will produce another restore hole. The header already knows this.

3. **Freeze `programs/` now.** The pairing has survived two full rounds. Every new finding in 13–15 was in same-day JS or comments. Further program edits reset the ship gate for a comment.

4. **One redemption client you control**, not a customer-composed message. If the Bank must sign, the Bank should *build* the tx (or take a structured intent and construct the allowlisted ix list). Judging a hostile `Transaction.from` is the harder program and you did not finish it.

5. **Measure CUs** on the 9.14 fixture on the same cloned Core validator. One number, pinned like 1119.

6. **Different model roster, frozen tree, no more features**, as SPEC already says. The next prompt should be: “here is `cosign.mjs` + `lock.mjs` + the drain test output. Does the drain test fail?” Not another 40k-token architecture dump.