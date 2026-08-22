

## FINDINGS

### 1. HIGH — one-lamport “ATA poisoning” crashes the payout and revenue jobs
**Where:** `bank/distribute.mjs` vault-balance loop; `bank/revenue.mjs` `opBefore` / `after`; `bank/distribute.mjs` distributor ATA read.

`distribute.mjs` does:

```js
const info = await conn.getAccountInfo(a, 'confirmed')
if (!info) { missing.push(v); balances[v] = '0'; continue }
balances[v] = String(info.data.readBigUInt64LE(64))
```

It only distinguishes **absent** from **present**. A present account with zero data makes `readBigUInt64LE(64)` throw. The prompt itself confirms a plain system transfer can credit lamports to a 0-data address.

**Concrete exploit**
1. Attacker picks any live, not-yet-activated vault from DAS.
2. Derives its asset-signer PDA and cbBTC ATA.
3. Sends 1 lamport to that ATA address.
4. Next daily `distribute.mjs` run fetches that account, gets `data.length == 0`, throws, and aborts the entire distribution. No vault is paid. The condition persists until code is patched or the account is somehow turned into a real token account.

The same shape exists in `revenue.mjs`:

```js
const opBefore = (await conn.getAccountInfo(opAta, 'confirmed'))?.data.readBigUInt64LE(64) ?? 0n
```

If the swap operator’s cbBTC ATA is poisoned before the first cycle, the script can throw **after** the sweep has already moved SOL to the operator, leaving an open cycle and wedging the pipeline.

This does not contradict the 200-assertion suite: the suite never runs `distribute.mjs` against a poisoned ATA, and the on-chain evidence would be a 1-lamport, 0-data account at a derived ATA address.

**Fix:** add one shared helper:

```js
function readTokenAmount(info) {
  if (!info) return null
  if (!info.owner.equals(TOKEN)) return null
  if (info.data.length < 72) return null
  return info.data.readBigUInt64LE(64)
}
```

For vault balances, treat a poisoned ATA as `0` / `missing` and report it per-vault; do not abort the whole run. For the distributor and operator ATAs, fail with an explicit “poisoned/non-token ATA” message **before moving funds**.

---

### 2. HIGH — `lock.mjs` stale-break plus unconditional release can double-pay
**Where:** `bank/lock.mjs` `acquireLock`, `releaseLock`, `withLock`; `bank/distribute.mjs` whole-ledger `save(st)`.

`acquireLock` breaks a stale lock by overwriting the file, but the lock has no ownership token. `releaseLock` unconditionally unlinks the file:

```js
export function releaseLock(file) { try { fs.unlinkSync(file) } catch {} }
```

`withLock` always calls `releaseLock` in `finally`.

**Concrete exploit**
1. Distribute run A starts, acquires the lock, loads `distributions.json`, begins paying.
2. A hangs inside an RPC call for longer than `staleMs` (20 hours).
3. Cron run B starts, sees the lock stale, overwrites it, loads the current ledger, and pays the next day’s plan.
4. A eventually resumes, still holding its old in-memory `st`, finishes, calls `save(st)`, and overwrites B’s payment records.
5. A’s `finally` then unlinks B’s lock.

The ledger now lacks B’s payments. A later run can pay those vaults again. The lock is supposed to prevent exactly this.

Evidence in a test: create a lock file with an old timestamp, start two processes, and observe the second break the lock while the first later deletes it.

**Fix:** put a random token in the lock payload; release only if the file still contains your token. If a process discovers its lock was stolen, it must abort before saving. Long jobs should also heartbeat/renew the lock, and money ledgers should avoid whole-object saves from stale in-memory state.

---

### 3. MEDIUM — an unledgered sweep is reported once, then silently dropped
**Where:** `bank/detectors.mjs` `detectDeferredSweeps`; `bank/alarm.mjs` state write.

When a stale deferred sweep has no ledger row, `detectDeferredSweeps` reports it but does **not** keep it:

```js
out.push({ kind: 'unledgered_sweep', ... })
```

If the alert is delivered, alarm state stores only `dsw.keep`, so the sweep disappears from state. The transaction cursor has already advanced, so no future pass sees it again.

**Concrete exploit / failure**
1. Compromised operator sweeps SOL outside `revenue.mjs` and writes no ledger row.
2. Alarm reports `unledgered_sweep` once.
3. If that one alert is missed, acknowledged incorrectly, or drowned, the missing SOL is never raised again.

This is a silence path created by the grace-window carry mechanism. There is no `resolvedBy` equivalent for sweeps.

**Fix:** keep reported unledgered sweeps in alarm state until either a ledger row appears or a human resolution marker is added. Re-report at a reduced frequency instead of dropping after one successful delivery.

---

### 4. MEDIUM — split confirmation timeout permanently wedges the revenue cycle
**Where:** `bank/revenue.mjs` step 4; `bank/detectors.mjs` `cycleIsOpen`.

The round-10 fix handles a front-run split by catching `NothingToSplit` and proving the revenue ATA is empty. It does not handle the ordinary failure path: `sendAndConfirmTransaction` throws a confirmation timeout for a split that **landed**.

In that case:
- error does not match `/NothingToSplit/`;
- `cycle.splitSig` is never saved;
- `cycle.splitByOther` is not set;
- `cycleIsOpen` remains true;
- every later `revenue.mjs` run refuses to start because an open cycle exists.

This is the same refused-vs-unconfirmed class that was fixed elsewhere, but the split send itself has no intent row and no timeout recovery.

**Fix:** write a split intent before sending. On timeout, inspect the revenue ATA and recent MINT signatures; if the ATA is empty and a split is visible, record a resolvable state. At minimum, allow manual resolution instead of requiring hand-editing the ledger.

---

### 5. LOW — second-site gaps in the round-10 repairs
**Where:** `bank/distribute.mjs --selftest`; `bank/alarm.mjs` EVER marker.

1. `bank/selftest.mjs` now has an assertion floor, but `distribute.mjs --selftest` does not. If that selftest is truncated or returns early with no failing assertion, it can still exit 0. Add a hardcoded floor there too.

2. `alarm.mjs` writes the EVER marker before `writeState(next)`. A crash between those two writes on a fresh box makes the next real run refuse to start because EVER exists but `state.json` does not. Write EVER only after state is successfully written.

---

## WHAT I TRIED AND COULD NOT BREAK

- **`splitByOther` proof:** a stranger cannot split to their own addresses. `split_revenue` derives the revenue, holders, and bank ATAs from config and the caller-supplied mint; the revenue PDA must sign the token transfer. Front-running only pays the pinned distributor and Bank ATAs. An empty revenue ATA after `NothingToSplit` is adequate proof for that narrow race.
- **Split-signature reuse:** `detectSplitClaims` catches the same `splitSig` across the whole ledger, including cycles older than the horizon.
- **Dry-run marker:** `--dry-run` in alarm, revenue, and distribute does not stamp the has-run marker or write money ledgers.
- **Watched-key assertion:** `missingWatchedKeys` now covers `gov.pending_admin`, pending SEAL/BURN rotations, and operator rotation fields; `readConfigs` throws if a watched key is not produced.
- **Core pin:** `CBOB_CORE_SHA256` is no longer an override; the expected hash is hardcoded in both test and build scripts.
- **Vault mechanics:** open/close pairing, Bank co-signature on both halves, delegate/close-authority checks in both burn loops, additive reserve list, and Core CPI encodings still hold against the live suite.
- **Governance:** VoteRecord PDA blocks transfer-and-revote; quorum uses `max(snapshot, live)`; execution is monotonic; rotations are timelocked.

---

## THE SINGLE THING TO FIX FIRST

Fix the token-account reads in `bank/distribute.mjs` and `bank/revenue.mjs`. Until a present 0-data account is treated as invalid/zero rather than a `RangeError`, any stranger can halt the daily cbBTC distribution, or wedge a revenue cycle after SOL has already moved, for the cost of one lamport.