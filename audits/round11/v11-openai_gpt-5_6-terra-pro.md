## Findings

### CRITICAL — stale-lock “recovery” can run concurrent distributions and double-pay vaults

**Construct:** `bank/lock.mjs`, `acquireLock()` and `withLock()`; used by `bank/distribute.mjs` with `staleMs: 20 * 3600_000`.

The lock is not ownership-safe. Once a lock is older than `staleMs`, any second process overwrites it with:

```js
fs.writeFileSync(file, payload)
return { ok: true, broke: held, ageMs: age }
```

This is neither an atomic compare-and-swap nor proof that the original holder is dead. It is merely a time-based overwrite. The original process continues running and still has its in-memory distribution ledger and signing key.

Worse, when the original runner eventually exits, `finally { releaseLock(file) }` unconditionally deletes the lock file — which at that point belongs to the replacement runner. A third runner can then enter concurrently.

**Concrete exploit / failure sequence:**

1. Distributor A starts a daily payout and obtains `.distribute.lock`.
2. A is slow but alive: RPC confirmation latency, rate limiting, or 2,100 sequential confirmed transfers make the job exceed 20 hours. Nothing refreshes the lock timestamp.
3. An operator manually starts `distribute.mjs`, or a delayed/duplicated scheduler invocation occurs after the 20-hour threshold.
4. Distributor B sees A’s lock as stale, overwrites it, and begins with a ledger snapshot that may predate A’s later transfers.
5. A and B both send transfers and both rewrite `distributions.json`. Each can pay a vault the other has not yet recorded.
6. When A exits, it deletes B’s lock. Distributor C can now start while B remains active.

This directly defeats the principal anti-double-payment control. The 20-hour repair reduces the probability relative to six hours but does not establish mutual exclusion. The suite’s lock tests test sequential acquisition and stale replacement, not a live holder exceeding the lease or lock ownership after replacement.

**Evidence expected if true:** start one holder, advance/use a mocked clock beyond `staleMs` without terminating it, acquire from a second process, and observe both callbacks execute. Then release the first holder and observe a third acquisition succeeds while the second callback is still active. This can be reproduced without Solana.

**Fix:**

- Do not implement a lease by overwriting a pathname unless there is robust ownership and renewal semantics.
- Prefer an OS advisory lock held on an open FD (`flock` / a native lock implementation). Kernel release on process death eliminates stale-timeout guessing.
- If a lease is unavoidable, use an unguessable ownership token, heartbeat it substantially below expiry, and make release conditional on ownership. However, this still needs an atomic stale-steal primitive; a plain overwrite or rename is not sufficient.
- Treat an overlong live distribution as an operational alert, not evidence that a second distributor is safe to start.
- Add a multiprocess regression test for the exact A/B/C sequence above.

---

### HIGH — the distribution SOL floor ignores transfers marked `rejected`, then retries them anyway

**Construct:** `bank/distribute.mjs`:

```js
const outstanding = plan.activated.filter(v => !done[v]).length
const needSol = 5_000 * outstanding * 2
```

Later, the same run treats a rejected prior payment as retryable:

```js
const state = paymentState(done[v])
...
if (state === 'ambiguous') { ... continue }
// `rejected` returns `unpaid`, so it is sent again.
```

A rejected row exists in `done[v]`, so it is excluded from `outstanding`; but `paymentState()` returns `unpaid` for that row and the loop attempts a transfer. The recent refused-versus-unconfirmed repair correctly changed retry behavior, but the fee-budget calculation was not updated to use the same state predicate.

**Concrete failure sequence:**

1. A large number of destination transfers are rejected, for example because cbBTC destination accounts are frozen.
2. Those rows persist as `{ sig: null, rejected: true, ... }`.
3. The accounts become transferable again, or the job is rerun after a transient refusal.
4. On resume, `outstanding` is near zero because all rows exist in `done`.
5. The script accepts an arbitrarily small SOL balance, then retries every rejected transfer.
6. It exhausts distributor SOL partway through the retry set. Some vaults are paid; remaining transfers fail with insufficient funds.

This is not a double-payment path, but it makes a previously failed daily distribution predictably partial under exactly the recovery path intended to repair it. It can also leave the day unfinished repeatedly until someone notices and funds the distributor.

**Evidence expected if true:** construct a ledger day with 2,100 activated vaults all having `{ rejected: true, sig: null }`; the current `outstanding` evaluates to zero while the loop will attempt 2,100 sends.

**Fix:**

Calculate fee exposure using the same state machine as the payment loop:

```js
const outstanding = plan.activated.filter(v => {
  const row = done[v]
  return !row?.skipped && paymentState(row) === 'unpaid'
}).length
```

Ambiguous rows should remain excluded because they are deliberately not retransmitted. Paid and deliberately skipped rows should remain excluded. Add a self-test proving rejected rows count toward the required SOL floor while ambiguous and skipped rows do not.

---

## What I tried and could not break

- **Operator rotation notice / pause:** `swap_operator` is no longer changed immediately. `set_paused` blocks `sweep_sol_for_swap` before the operator check, so pausing is a real same-transaction stop while a replacement waits. I did not find a caller-controlled route that sends a sweep to `pending_operator`.
- **`splitByOther`:** an external caller cannot choose split destinations: `split_revenue` derives the revenue, distributor, and Bank ATAs from config and the passed mint. If the revenue cbBTC ATA is empty following a `NothingToSplit` refusal, the cycle’s returned balance has in fact been removed through the constrained split path. This is bookkeeping loss, not an obvious redirection primitive.
- **Split signature reuse:** `detectSplitClaims()` now checks duplicate signatures across the whole ledger before applying the age horizon. The prior old-signature-to-new-row closure route is closed in this function.
- **Deferred-sweep delivery failure:** the failed-delivery branch now carries prior deferred entries plus newly deferred entries rather than writing only `dsw.keep`. I did not find the previous report-and-drop behavior at that site.
- **Distribution refused/unconfirmed reporting:** `detectDistribution()` now excludes `rejected` rows from unresolved transfers and reports them separately. The retry semantics in `paymentState()` match that distinction; the remaining defect is the separate fee-floor calculation above.
- **Dry-run marker behavior:** `alarm.mjs` does not write `.alarm-has-run` under `--dry-run`.
- **Core byte pin and mainnet mint facts:** the Core digest is hardcoded in both scripts rather than environment-overridable. The probe checks live ownership and 82-byte mint lengths for cbBTC, GARY, and GIRAFFISH. I did not reassert the rejected Token-2022 claim.
- **Royalties CPI:** the supplied validator suite does execute both add and update against cloned mainnet Core and fetches decoded values afterward. I found no basis to claim that this path is untested or malformed.
- **Vault mechanics:** I found no new concrete bypass of the owner-plus-Bank redemption gate, reserve checks, canonical wiring checks, or vote-record asset binding in the supplied code.

## The single thing to fix before this holds real money

Replace `bank/lock.mjs`’s stale-file overwrite lock with ownership-safe kernel-backed mutual exclusion. Until then, a slow but live payout can be joined by another payout process, and the result can be direct duplicate cbBTC payments.