# CBOB VAULTS — ROUND 10 AUDIT

## FINDINGS

---

### 1. HIGH — `update_wiring`: `swap_operator` rotates INSTANTLY on one admin signature, and the comment defending it is false

**File/identifier:** `programs/cbob-vault-mint/src/lib.rs`, `update_wiring`, the `if let Some(x) = swap_operator` block.

The comment says: *"Replacing the swap operator cannot redirect anyone's money: the destination it names is where OUR SOL goes."* That is exactly what redirecting money is. `sweep_sol_for_swap` transfers to `cfg.swap_operator`. So:

1. Attacker holds the admin key (the threat model that justifies the timelocks on `admin`, `governance` and `bank` in this very function).
2. `update_wiring(swap_operator = attacker_key)` — instant, no governance, no notice.
3. `sweep_sol_for_swap(max_sweep_lamports)` signed by `attacker_key`. Repeat every `sweep_cooldown_secs`.

At the documented settings (50 SOL / 6 h) that is 200 SOL/day of holders' money, 85% of which is owed to vault holders, with a 30-minute alarm latency and no timelock to look at. Every *other* control on this account waits days precisely so a stolen admin key is survivable; this one does not, and it is the one that touches the balance.

**Fix:** keep the instant rotation (the emergency argument is sound) but make it a *stop*, not a *start*: on rotation set `c.last_sweep_at = now.checked_add(c.governance_timelock_secs)`. A compromised operator is disabled the same hour; the *new* operator cannot sweep until the notice period the alarm is already shouting about has run. Alternatively split it: instant `swap_operator = Pubkey::default()` (disable) admin-only, any non-default value timelocked.

---

### 2. HIGH — a stranger can permanently wedge the revenue pipeline for one transaction fee, by front-running the permissionless `split_revenue`

**Files:** `programs/cbob-vault-mint/src/lib.rs::split_revenue` (permissionless, correct) + `bank/revenue.mjs` (step 4) + `detectors.mjs::cycleIsOpen`.

`revenue.mjs` returns the cbBTC to the revenue ATA in one transaction and then splits it in the *next* one. Anyone watching the revenue ATA can submit their own `split_revenue` in between. The money is divided correctly on-chain — but:

* `revenue.mjs`'s split throws `NothingToSplit` → `cycle.splitSig` is never written.
* `cycleIsOpen(c)` = `returnedSats > 0 && !splitSig` → **true, forever**.
* The next run's open-cycle guard `throw`s: *"Resolve them by hand."* **Every future revenue cycle is blocked** until a human hand-edits the JSON. SOL accrues in the revenue PDA and is never swapped.
* `detectUnreconciledRevenue` emits `cycle_unsplit` HIGH on every 30-minute pass forever (it has no age horizon — see #5).

Cost to the griefer: one transaction, repeatable after every manual repair. This is the same shape as the round-7 `sweep_sol_for_swap(0)` grief handle, relocated to the other end of the cycle.

**Fix:** on `NothingToSplit`, re-read the revenue ATA; if it is empty the split happened, so record it (`cycle.splitByOther = true`, plus the signature found in a short `getSignaturesForAddress` scan) and close the cycle. And make `cycleIsOpen` fall back to "the revenue ATA still holds this cycle's sats" rather than resting solely on a field this process writes. Belt: do the return-transfer and the split in **one transaction** — nothing prevents it, and it removes the window entirely.

---

### 3. HIGH — a CRITICAL `unledgered_sweep` is destroyed when the alert fails to send (defect in round 9's own fix)

**File:** `bank/alarm.mjs`, the `if (!delivered)` block.

`detectDeferredSweeps` returns `keep` = only the sweeps *still too fresh to judge*. A deferred sweep that has become stale and just produced a CRITICAL is dropped from `keep` by construction. On `!delivered` the code reverts `config`, `activation`, `balances`, `cursors` and `vaults` — **and not `deferredSweeps`**:

```js
next.deferredSweeps = dsw.keep    // set before the delivery check, never reverted
```

Reverting `cursors` does not help: the sweep transaction was consumed by an *earlier* pass, so it will never be re-fetched. Sequence: sweep lands at :41, scanned at :53 (deferred, correct), judged at :23 next hour → CRITICAL → SMTP/notify fails → state saved with `deferredSweeps: []` → the operator key moved SOL outside the ledger and nothing will ever say so again. This is precisely the round-7 "cursors advanced even when the alert failed" bug, relocated into the round-9 deferral mechanism.

**Fix:** inside `if (!delivered)`, `next.deferredSweeps = [...(prev?.deferredSweeps || []), ...deferredSweeps]` (drop nothing), and add `next.seenSplits = prev?.seenSplits ?? next.seenSplits` for symmetry.

---

### 4. HIGH — at charter scale the quorum is clearable by one wallet, and the only backstop is an unwritten Bank duty

**File:** `programs/cbob-vault-gov/src/lib.rs`, `MIN_QUORUM_BPS`, `execute_proposal`.

Quorum is a *percentage*: `need = ceil(max(snapshot, live) * quorum_bps / 10_000)`. The stated electorate immediately after the charter round is ~190 vaults with one holder at ~21% (≈40 vaults) and the top three at ~48% (≈91).

* `quorum_bps` may be as low as 500 (5%) → `need = 10` at 190 vaults, `need = 105` at 2,100.
* Threshold is a share of **votes cast**, so a sole voter always reads `yes_bps = 10_000`.

So with any `quorum_bps ≤ 2100` — and 500 is legal, and `update_gov_config` lets admin move quorum *down* — the 21% holder alone satisfies both tests and ratifies **any** round: `price_lamports = 0`, `cap = 1911`, a window opening now. `max_supply` is the only on-chain bound, and it permits exactly the whole remaining supply. The sole remaining control is the Bank refusing to co-sign 1,911 free mints — a duty that is written down for *delegates and undeclared token accounts* and for *mints during a voting window*, but nowhere for *price*.

**Fix:** `need = max(ceil(divisor * bps / 10_000), MIN_ABSOLUTE_VOTES)` with `MIN_ABSOLUTE_VOTES` above the largest known holding (e.g. 96), and raise `MIN_QUORUM_BPS` above the top-holder share (≥ 3000). Add a standing check in `detectStandingRisks`: CRITICAL when `ceil(minted_total * gov.quorum_bps / 10000)` is below a configured concentration figure. Write the price duty into the Bank's written duties either way.

---

### 5. MEDIUM — two money detectors have no horizon and no resolution path, so one bad day is a permanent CRITICAL

**File:** `bank/detectors.mjs::detectDistribution` (and `detectUnreconciledRevenue`).

`detectDistribution` iterates **every day ever recorded**. A row with `sig: null` and no `skipped` (the *ambiguous* state `distribute.mjs` deliberately creates on a confirmation timeout) yields `distribution_unresolved` CRITICAL on every pass, forever — and **nothing in `distribute.mjs` can ever clear it**; the only remedy is hand-editing `distributions.json`, which the ledger's own `.has-run` discipline discourages. Likewise `startedAt` without `finishedAt` (e.g. the SOL-floor abort) is a HIGH every 30 minutes for the life of the system. `detectUnreconciledRevenue` has the same shape: no `horizonDays`, unlike `detectSplitClaims` which got one.

This is the class round 9 said it closed ("two detectors on their way to permanent noise"); it was closed for two *cases*, not for the *iteration*.

**Fix:** give both detectors a `horizonDays` bound like `detectSplitClaims`, and add a supported resolution: `distribute.mjs --resolve <day> <vault> <sig|none>` that writes `sig` or `skipped` so the finding closes through code rather than an editor.

---

### 6. MEDIUM — `gov.pending_admin` is branched on by a detector and is in neither `WATCH` nor `WATCHED_KEYS`

**File:** `bank/detectors.mjs`.

`detectStandingRisks`'s `rotation_armed` loop reads seven keys. Six are covered by the round-9 completeness assertion; `gov.pending_admin` — the key that arms a rotation of *the account that can move `quorum_bps`* — is in neither list. `readConfigs` happens to produce it today, so the check runs; but the mechanical guarantee that was the whole point of `missingWatchedKeys` does not cover it, and it is also absent from the drift list, so a re-arm from key A to key B produces no `config_drift` line. The hole is exactly one key wide and it is the one that pairs with finding #4.

**Fix:** add `['gov.pending_admin', CRITICAL, 'A GOV ADMIN ROTATION IS ARMED']` to `WATCH`, and derive the rotation-armed key list and `WATCHED_KEYS` from a single exported constant so the two cannot diverge again.

---

### 7. MEDIUM — `sol_reserve_lamports == 0` can brick low-price minting; the comment says otherwise

**File:** `programs/cbob-vault-mint/src/lib.rs`, `RENT_EXEMPT_0_BYTES` comment: *"Zero is fine (the PDA simply closes and is recreated by the next payment)."*

False. A system transfer that leaves an account with a non-zero balance **below** `minimum_balance(0) = 890,880` is rejected (`InsufficientFundsForRent`); a zero-lamport account is `Uninitialized`, and `Uninitialized → RentPaying` is not an allowed transition. So after a sweep takes the revenue PDA to exactly zero, any `mint_vault` with `0 < price_lamports < 890_880` **reverts**, and so does any marketplace royalty transfer under that size. The sale wedges until someone donates 0.00089 SOL to the PDA.

**Fix:** drop the `x == 0 ||` carve-out in both `initialize` and `update_wiring` — require `sol_reserve_lamports >= RENT_EXEMPT_0_BYTES` unconditionally — and correct the comment.

---

### 8. MEDIUM — the Core byte-identity gate is defeated by an environment variable (the class fixed for `MIN_ASSERTIONS`, unfixed here)

**Files:** `scripts/run-tests.sh` (`CORE_SHA256_EXPECTED="${CBOB_CORE_SHA256:-…}"`, `CACHE="${CBOB_CACHE:-…}"`), same two lines in `build-mainnet.sh::boot`.

Round 7 removed the env override on the assertion floor because *"anyone who would point CBOB_TEST_FILE at a smaller suite would set CBOB_MIN_ASSERTIONS too."* Identical here: `CBOB_CACHE=/tmp/mine CBOB_CORE_SHA256=$(sha256sum mock.so)` produces a fully green run, and both scripts then print *"cache matches the PINNED mainnet sha256"* and *"VERIFIED. Deploy these bytes"*. This is the gate that makes every other assertion mean something.

**Fix:** hardcode the constant; `[ -z "${CBOB_CORE_SHA256:-}" ] || die "the Core hash is pinned in this file"`, and the same for `CBOB_CACHE`.

---

### 9. MEDIUM — `distribute.mjs` reads an absent distributor ATA as "no cbBTC" and marks the day legitimately finished

**File:** `bank/distribute.mjs`: `const available = srcInfo ? srcInfo.data.readBigUInt64LE(64) : 0n`.

A null `getAccountInfo` (lagging node, wrong commitment, transient RPC) is indistinguishable from a genuinely empty treasury. `allocate` then returns `skip: 'no cbBTC to distribute'`, the day is stamped `nothingToDo` + `finishedAt`, and `detectDistribution` treats that as **resolved** — so a whole day's payout is silently skipped with the watcher explicitly satisfied. This is the `catch { bal = '0' }` failure the alarm was rewritten to eliminate, still present in the job that actually moves the money, and the cron only fires once a day.

**Fix:** if `srcInfo` is null *and* the ledger already contains any prior day, throw (the ATA cannot un-exist). Record `available` in the `nothingToDo` record and have `detectDistribution` raise a HIGH on a `nothingToDo` day whose recorded `available` is absent.

---

### 10. LOW — `bank/revenue.mjs` and `bank/distribute.mjs` read MINT's config by raw offset with no discriminator and no version byte

Every program pins sibling configs by disc + version; `alarm.mjs` was fixed to read and watch `version`. These two — which sweep 50 SOL and pay every vault — read `holders@137`, `bank@221`, `operator@256`, `reserve@288`, `cap@297`, `cooldown@305`, `last_sweep@313`, `minted_total@205` with nothing pinned. Two accidental cross-checks (operator vs. local key, treasury vs. distributor key) make the worst cases throw, but `chainCap`, `cooldown`, `reserve` and `splitBps` would be read as garbage after a MINT upgrade that inserted a field. Add the 8-byte disc + `version` assertion to both.

### 11. LOW — `bank/lock.mjs` was not supplied, and its selftest cannot test what matters

`withLock`, `readLedger`, `writeLedger` carry the entire double-pay defence and were not in the package. The selftest calls `acquireLock` twice **in the same process**, which proves nothing about a second process, and nothing tests that `writeLedger` is atomic (temp + `rename`) — a crash mid-write leaves a truncated ledger, which `readLedger` correctly refuses, which means **no payouts at all** until a human intervenes. Ship it for review; add a test that forks.

### 12. LOW — `MIN_ASSERTIONS=160` vs. the brief's "82-assertion suite"

If `tests/3prog.test.ts` prints `82/82 as predicted`, `run-tests.sh` dies with *"stopped early"*. Either the runner cannot pass or the floor is counting something other than what the brief describes. Reconcile the number and state which line it reads. Also: `build-mainnet.sh`'s banner still says SEAL rejects *"by reaching a check below it"* — SEAL's `INIT_AUTHORITY` check moved to the top in round 6, so the caveat is stale and understates what was proven.

---

## WHAT I TRIED AND COULD NOT BREAK

* **Double voting in GOV.** `["vote", proposal, asset]` holds across transfers; a burnt asset fails `read_core_asset` (Core closes the account, so `*asset.owner != MPL_CORE_ID`); the collection account itself has `data[0] == KEY_COLLECTION`, not `KEY_ASSET_V1`; a delegate has no owner bytes. No path found.
* **Executing twice / after a newer proposal / stale.** `executed` set before the CPI, `EXECUTION_WINDOW_SECS`, `RoundAlreadyOver`, and `last_executed_id` monotonicity together closed every ordering I tried. The CPI account list and order match MINT's `SetRound` exactly.
* **All four account-space arithmetic sums** recomputed field by field: `GovConfig` 142, `Proposal` 82, `MintConfig` 449, `BurnConfig` 186, and every offset in `readConfigs` (including `gov.last_executed_id@94`, `mint.pending_bank_at@441`, `burn.pending_admin_at@178`) is correct. SEAL's post-Vec pendings are computed from the live length; MINT/BURN read only pre-Vec offsets. No misread found.
* **`split_revenue` rounding.** Bank floored, holders take the remainder; the two transfers sum to `total` exactly at 0, 1, and near `u64::MAX`; a hostile `mint` argument only reaches an ATA the attacker had to fund with a worthless token. `TransferChecked` binds the mint to both accounts.
* **`sweep_sol_for_swap` pin.** Destination is `cfg.swap_operator`, never an argument; `amount > 0`, `<= max_sweep_lamports`, cooldown floor 1 s defeats two sweeps in one transaction, `bal >= keep + amount`. The only hole is who *sets* the pin — finding #1.
* **`apply_pending_*` cross-clearing** in all four programs: MINT's three appliers each touch only their own slot (round 9's fix is real); SEAL/BURN `apply_pending` applies each independently. `cancel_pending` in SEAL/BURN clears both slots, which is documented and admin-gated — an availability wart, not a hole.
* **`missingWatchedKeys`**, `detectIndexShortfall`'s array guard, the `--dry-run` non-consumption, the `seenSplits` un-slicing, `paymentState`'s `rejected` branch, and the `.has-run` markers all check out as described.
* **cron re-run idempotency:** the `$TAG` filter matches every installed line; `crontab -l | grep -cF` really is 5 and stays 5; `--live` is preserved. One residual: the crontab does not export `CBOB_ALARM_STATE`, so the deadman's path is fixed from the *installer's* environment — it fails loud rather than quiet, but export it on both lines.

---

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Finding #1.** Make an instant `swap_operator` rotation a *brake*, not a *tap*: stamp `last_sweep_at = now + governance_timelock_secs` whenever admin changes it. Today one admin signature redirects every future sweep of the revenue PDA — 85% of which is the holders' — with no notice period, no governance, and a comment in the source asserting the opposite.