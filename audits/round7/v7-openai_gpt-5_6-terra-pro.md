## FINDINGS

### 1. CRITICAL — the “on-chain cooldown” can be configured to zero, so the sweep cap is again only a step size

**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `initialize` and `update_wiring`, checks on `sweep_cooldown_secs`.

```rust
require!((0..=MAX_SWEEP_COOLDOWN_SECS).contains(&sweep_cooldown_secs), ...)
```

and identically in `update_wiring`.

**Exploit:** Initialize production with `sweep_cooldown_secs = 0`, or have the current admin and governance sign:

```text
update_wiring(..., sweep_cooldown_secs: Some(0), ...)
```

Then anyone—not merely the swap operator—can invoke `sweep_sol_for_swap` repeatedly in one transaction or consecutive transactions. Each call is bounded by `max_sweep_lamports`, but `last_sweep_at + 0` always permits the next call. The revenue PDA can therefore be drained down to `sol_reserve_lamports` in `max_sweep_lamports` chunks, all sent to the pinned operator.

If the operator key is compromised, the attacker receives essentially all sweepable SOL, rather than one capped cycle.

This is not theoretical: `detectStandingRisks()` itself states that a zero cooldown makes the bound ineffective:

```js
BigInt(cap) === 0n || Number(cool) <= 0
```

The detector recognizes the unsafe state, but the program explicitly permits it. A 30-minute alarm cannot restore an on-chain rate limit after the SOL has moved.

**Fix:** Require a strictly positive cooldown on-chain:

```rust
const MIN_SWEEP_COOLDOWN_SECS: i64 = 1; // preferably production-scale
require!((MIN_SWEEP_COOLDOWN_SECS..=MAX_SWEEP_COOLDOWN_SECS).contains(&x), ...);
```

If zero is needed only for tests, make it available only under `localnet`, not in the deployable production binary. Also alarm on a production cooldown below an operational minimum, not merely `<= 0`.

---

### 2. HIGH — production governance takeover can be armed with a 60-second notice, and the claimed alarm assertion does not exist

**Construct:** `programs/cbob-vault-mint/src/lib.rs`:

```rust
const MIN_GOVERNANCE_TIMELOCK_SECS: i64 = 60;
```

`initialize` accepts 60 seconds; `update_wiring` permits the initial value to remain 60 forever; `apply_pending_governance` is permissionless after expiry.

The stated compensating control is false. `bank/alarm.mjs::readConfigs()` does **not** read `governance_timelock_secs` at offset 361, and neither `detectStandingRisks()` nor `detectConfigDrift()` checks that it is days rather than 60 seconds.

**Exploit:**

1. Production is initialized with `governance_timelock_secs = 60`, whether by error or an administrator choosing the test floor.
2. An attacker with the MINT admin key calls `update_wiring(governance: Some(attacker_key), ...)`. This does not require the current governance signer.
3. After 60 seconds, anyone calls `apply_pending_governance`.
4. The attacker now satisfies both required roles for protected wiring changes: they retain admin and now hold governance.
5. They can set `split_bps = 0`, direct `bank_treasury` to themselves, rotate `swap_operator`, lower the SOL reserve, or alter sweep bounds/cooldown subject to the separate defects above.

The watcher runs at `:23,:53`; a 60-second timelock can start and finish entirely between watcher passes. The pending-governance alert is not a meaningful notice period at that setting.

**Evidence test:** initialize a validator deployment with 60 seconds, arm a replacement governance key, wait 61 seconds, apply it, then use admin+new-governance signatures to change `bank_treasury` or `split_bps`. The current alarm snapshot will contain no `mint.governance_timelock_secs` field and emit no weak-timelock finding.

**Fix:** Enforce a production-safe minimum in the shipped program, ideally days. If short execution tests are required, gate the 60-second floor behind `localnet`. At minimum, read and continuously enforce/alarm on `mint.governance_timelock_secs`, but an alarm is not an adequate substitute for an on-chain minimum where the attacker’s window is shorter than the polling interval.

---

### 3. HIGH — distribution permanently skips ambiguous and failed transfers while marking the day finished

**Construct:** `bank/distribute.mjs`, per-vault ledger handling:

```js
if (done[v]) continue
...
done[v] = { amount: String(plan.per), sig: null, sentAt: ... }; save(st)
...
catch (e) {
  done[v] = { amount: String(plan.per), sig: null, error: ... }
  save(st); failed.push(v)
}
...
st.days[day].finishedAt = ...
```

**Exploit / failure sequence:**

1. A vault is activated and included in the fixed daily plan.
2. The script writes an intent with `sig: null`.
3. `sendAndConfirmTransaction` times out after a transaction may or may not have landed, or the destination is frozen and the transfer genuinely fails.
4. The catch stores another `sig: null`.
5. Every later same-day run executes `if (done[v]) continue`; it neither queries the chain nor retries.
6. The run records `finishedAt` despite failures.

Thus the code safely avoids an immediate duplicate payment, but converts any RPC ambiguity or transient destination failure into an unrecoverable same-day omission. The promised equal daily allocation is not delivered; the unpaid amount remains in the distributor account and becomes part of a later day’s different divisor and potentially different activation set.

**Fix:** Model entries as `intent`, `confirmed`, and `failed-retryable`, not merely truthy `done`. On resume:

* for an intent with a signature, fetch and verify the transaction and destination balance;
* for an intent without a signature or a known pre-send failure, retry safely;
* do not set `finishedAt` while unresolved entries remain;
* alert unresolved entries distinctly and require an explicit operator resolution for genuinely ambiguous sends.

A robust implementation needs an idempotency/reconciliation rule based on pre-transfer destination balance plus expected amount, or a durable submitted signature before confirmation.

---

### 4. HIGH — DAS completeness checks accept duplicate IDs and over-counts, allowing a partial collection to be treated as complete

**Constructs:**

* `bank/distribute.mjs`:

```js
if (BigInt(vaults.length + burnt.length) < mintedTotal) throw ...
```

* `bank/alarm.mjs::reconcile()` and normal alarm pass:
  `detectIndexShortfall(..., live.length, burnt.length)`.

Neither path de-duplicates asset IDs or requires exact agreement with `minted_total`.

**Exploit / failure mode:** An RPC/DAS response can omit real vaults while repeating other IDs across pages, or return duplicate records. If the raw count reaches `minted_total`, the check passes. In `distribute.mjs`, `balances` is an object keyed by asset ID, so duplicates collapse before `allocate()`:

```js
balances[v] = ...
```

A response containing 2,100 copies of one vault can satisfy the count check but produce one activated recipient. The day’s distributable cbBTC is then paid to that one visible vault, while omitted vaults receive nothing.

This does not require a customer-controlled transaction; it is precisely the untrusted-index/partial-read failure the code says it refuses to guess about. The present test only proves a count shortfall, not duplicate inflation.

**Fix:** Build `Set`s of live and burnt IDs; reject duplicates, reject overlap between live and burnt, and require:

```text
unique_live + unique_burnt == minted_total
```

not merely `>=`. Use the deduplicated live set everywhere downstream. Add a synthetic test with duplicates whose raw count equals `minted_total` but unique count does not.

---

### 5. MEDIUM — `revenue.mjs` still treats a recorded zero return as a completed cycle

**Construct:** `bank/revenue.mjs`:

```js
const open = (led.cycles || []).filter(
  c => (c.sweptLamports || c.intendedLamports) && !c.returnedSats
)
```

A serialized zero is `"0"`, which is truthy in JavaScript. Therefore `!c.returnedSats` is false and a cycle with:

```json
{ "sweptLamports": "50000000000", "returnedSats": "0" }
```

is treated as closed by the live revenue runner.

**Impact:** This reintroduces the exact truthiness class fixed in the alarm detector: a zero-return cycle does not block the next sweep. The alarm and `--audit` eventually identify it, but `revenue.mjs --live` can continue beginning later cycles instead of halting on undelivered funds.

**Fix:**

```js
const open = (led.cycles || []).filter(c =>
  BigInt(c.sweptLamports ?? c.intendedLamports ?? 0) > 0n &&
  BigInt(c.returnedSats ?? 0) === 0n
)
```

Use this shared predicate in `main`, `audit`, and alarm reconciliation. Add a live-run unit test for string `"0"`.

---

### 6. MEDIUM — `build-mainnet.sh` does not prove that the mainnet binary contains the Squads authority

**Construct:** `scripts/build-mainnet.sh`, `ask`/`ask_seal` and the final assertion.

The mainnet check requires only output containing `REJECTS` for the local test key. The localnet control requires only `ACCEPTS` for that same key.

That proves:

* localnet build accepts the local key;
* mainnet build does not accept the local key.

It does **not** prove that the mainnet build accepts `bc92...`, or that rejection occurred specifically as `NotTheInitAuthority`. The shell never checks the stated reason despite the final banner claiming it did.

**Evidence test:** change the non-localnet `INIT_AUTHORITY` to any third pubkey, rebuild, and run this script. The mainnet artifact still rejects the localnet test key; the localnet control still accepts it. The script certifies the wrong mainnet constant.

**Fix:** Make `initauth.test.ts` return machine-readable reason codes and assert them. More importantly, test acceptance of the intended Squads authority through a local Squads CPI fixture, or use a reproducible-build attestation plus byte-level/source-derived authority verification. Rejection of one unrelated key is not identity proof.

---

## What I could not break

* I found no double-vote route through ownership transfer: `VoteRecord` is seeded by proposal and asset, and Anchor `init` prevents a second record for that asset.
* A delegate does not satisfy governance standing: `cast_vote` compares live Core owner bytes to a required signer.
* Quorum is actually snapshotted at proposal creation in `Proposal.quorum_supply`; the stale live-divisor path is not present in execution.
* `split_revenue` derives all three token-account addresses from the supplied mint and fixed wallets, uses the fixed classic SPL Token program, and transfers from a PDA-signed source. I did not identify a caller-selected recipient route there.
* The sweep destination is checked against `config.swap_operator`; the failure is the permitted zero cooldown, not an unpinned account.
* The BURN reserve source is read from SEAL’s config rather than a second BURN copy.

## THE SINGLE THING TO FIX BEFORE REAL MONEY

Make sweep cooldown strictly positive and production-scale **in the on-chain MINT program**. As written, `0` is a valid configuration that restores effectively unlimited draining of sweepable SOL to the operator in a single transaction.