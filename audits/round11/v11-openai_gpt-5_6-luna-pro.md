## FINDINGS

### HIGH — stale-lock takeover is non-atomic and can allow concurrent money jobs

**Construct:** `bank/lock.mjs:acquireLock()` and `releaseLock()`.

When an existing lock is considered stale, both processes can execute:

```js
fs.writeFileSync(file, payload)
return { ok: true }
```

There is no atomic ownership transition. Two processes can simultaneously read the same stale lock, both overwrite it, and both proceed. Worse, the original process may still be alive but slow: the new process overwrites its lock, and the original process later executes `finally { releaseLock(file) }`, deleting the newer process's lock.

Concrete sequence:

1. `distribute.mjs` starts and acquires `.distribute.lock`.
2. RPC stalls or the payout takes longer than `staleMs` (20 hours).
3. A second cron/manual invocation sees an old timestamp and treats the lock as stale.
4. Both runners proceed with independent copies of `distributions.json`.
5. Each can send transfers based on the same pre-send ledger state.
6. The first runner's eventual `releaseLock()` can remove the second runner's lock, permitting a third runner as well.

The 20-hour timeout is below the 24-hour cadence, so this is not merely theoretical: an overrun or prolonged RPC outage can create exactly the condition intended to prevent concurrent payout.

The selftest only checks a normal fresh lock and a forced stale lock; it does not test two concurrent stale takers, an old owner releasing a replaced lock, or a process that remains alive past the timeout.

**Fix:** use an atomic stale-lock replacement. For example, write a uniquely named replacement, then atomically `rename()` it over the old lock only after rechecking its identity; include a random ownership token, and have `releaseLock()` unlink only if the lock still contains that token. Better still, use an OS lease/lock primitive with renewal while the job is active. Add a real concurrent-process test.

---

### HIGH — the on-chain sweep cap is not capped at the claimed 50 SOL

**Constructs:** `programs/cbob-vault-mint/src/lib.rs:initialize`, `update_wiring`, `sweep_sol_for_swap`; `bank/revenue.mjs:MAX_PER_CYCLE_LAMPORTS`; `tests/3prog.test.ts:SWEEP_CAP`.

The business and revenue comments describe a **50 SOL per-cycle** bound. The actual on-chain control only requires:

```rust
require!(max_sweep_lamports > 0, MintError::BadSweepBound);
```

and later accepts any `u64` value. Governance may also loosen it to any larger value because there is no absolute maximum. The off-chain 50 SOL constant is explicitly only a convenience and cannot constrain a caller or a compromised/alternate operator.

The test suite initializes:

```ts
const SWEEP_CAP = BigInt(100 * LAMPORTS_PER_SOL)
```

and successfully exercises the system with a 100 SOL cap. Thus the green suite proves the opposite of the stated 50 SOL operational bound.

Concrete impact:

1. The initialization authority sets `max_sweep_lamports` to 100 SOL or more, or a governance-controlled update loosens it.
2. The operator signs one valid sweep.
3. `sweep_sol_for_swap` transfers that entire amount, subject only to the reserve.
4. The operator key's per-transaction exposure is therefore larger than the claimed 50 SOL.

This is particularly important because the swap is the sole trusted off-chain hop. A cap larger than intended increases the amount that can be lost or stranded in one cycle.

**Fix:** enforce `MAX_SWEEP_LAMPORTS = 50 * LAMPORTS_PER_SOL` in both initialization and every update, and require `max_sweep_lamports <= MAX_SWEEP_LAMPORTS`. The alarm should report caps above the absolute maximum, not merely zero. Change the test to use the production maximum and add a rejection test for `50 SOL + 1`.

---

### MEDIUM — the watcher does not validate config discriminators, owners, or expected versions

**Construct:** `bank/alarm.mjs:readConfigs()`.

The reader obtains accounts at derived addresses and then reads raw offsets, but does not verify:

- account owner equals the expected program,
- the eight-byte Anchor discriminator equals the expected discriminator,
- the version byte equals the version this reader understands.

It only records `version` as a drift field. On a first run, an altered account with a plausible version is accepted as the baseline. After an upgrade, the reader can continue interpreting a changed layout under the old offsets until a human notices a drift finding; standing checks and subsequent collection/index work may already use nonsense values.

This is weaker than the on-chain sibling readers, which explicitly pin owner, discriminator, and version. The existing `missingWatchedKeys()` assertion proves only that keys are populated, not that the values came from the correct account schema.

**Fix:** make `g()` require the expected owner, discriminator, and exact supported version before reading any fields. Treat an unknown version or malformed account as a CRITICAL unreadable-config fault and do not advance state.

---

### LOW — ledger marker durability is best-effort, so deletion can still look like a first run

**Construct:** `bank/lock.mjs:writeLedger()`.

The ledger is renamed into place first, but marker creation is swallowed:

```js
if (marker) {
  try { fs.writeFileSync(marker, ...) } catch { /* best effort */ }
}
```

If the process crashes, loses permission, or the marker write fails after the ledger is saved, deleting the ledger later leaves no marker. `readLedger()` then returns the fallback as a fresh start. For `distributions.json`, the next run can treat every activated vault as unpaid and resend; for the revenue ledger, historical unreconciled sweeps disappear from local accounting.

This is a failure-path gap in the newly added “has-run” repair.

**Fix:** make marker creation part of a durable commit protocol, or store a generation/has-run record in a separate atomically replaced metadata file and refuse operation unless both ledger and metadata are present and consistent. Never swallow marker-write failure.

## WHAT I TRIED AND COULD NOT BREAK

- I found no surviving direct bypass of the SEAL owner-plus-Bank checks or the open/close instruction pairing.
- I found no way to redirect `split_revenue` destinations: the revenue PDA, distributor ATA, Bank ATA, and classic Tokenkeg program are derived or pinned.
- I found no second-vote path through transfer: the VoteRecord PDA remains seeded by proposal and asset.
- The burn checks consistently reject declared non-empty reserve accounts, delegates, close authorities, Token-2022 extensions, and nested Core assets. The known non-ATA completeness limitation remains explicit and is appropriately assigned to the Bank reconcile.
- The split-signature reuse check is ledger-wide, and `splitByOther` cannot redirect funds because the on-chain split destinations remain pinned.
- The presented tests do exercise real Core mint, redemption, burn, royalty add/update, and SPL transfers; I am not claiming those paths universally fail.

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Replace `acquireLock()` with an atomic, renewable ownership lease whose release cannot delete another runner’s lock. A payout ledger cannot prevent double payment if the process-level exclusion protecting it is itself racy.