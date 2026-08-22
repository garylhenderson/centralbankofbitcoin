## FINDINGS

### HIGH — Distribution can silently exclude missing vault ATAs and overpay the rest

**Construct:** `bank/distribute.mjs`, balance collection and `allocate()`.

For every vault:

```js
if (t.state === 'absent') { missing.push(v); balances[v] = '0'; continue }
```

`missing` is only printed to stderr later. It is not recorded in the distribution ledger, included in `failed`, returned as a detector finding, or sent through the notification path.

**Exploit/failure:** A vault that was previously activated can have its cbBTC ATA absent at the time of the run, or the DAS/RPC state can transiently disagree. The run computes the divisor using only readable activated vaults, then distributes the full available amount among them. The missing vault receives nothing, while the visible vaults receive a larger share. The run can be marked finished, so the omitted vault is not automatically retried.

A stranger can also create a one-lamport system account at a derived ATA address. That case is classified as `malformed` and merely printed, but it is likewise not represented in the ledger or alarm state.

**Fix:** Treat `absent`, `foreign`, and `malformed` vault ATAs as explicit per-vault unresolved faults. Do not finish the day while any such fault exists. Persist them in the day record and make the alarm emit a HIGH/CRITICAL finding. Decide the divisor and payout plan only after the complete set of vault reads succeeds, or explicitly define and persist a policy that excludes faulty vaults without silently reallocating their share.

The current comment says this is “reported”; the code only logs it.

---

### HIGH — Distribution has no chain-derived reconciliation; a compromised distributor key can drain customer funds without detection

**Construct:** `bank/distribute.mjs` and `bank/detectors.mjs`.

The distributor key is the authority on the source cbBTC ATA. The ledger is written by the same process/user that owns the key. The alarm checks ledger rows for missing signatures, but it does not scan Tokenkeg transfers from the distributor ATA and compare:

- destination,
- amount,
- number of transfers,
- destination vault,
- transfer signature,
- total debited amount.

**Exploit:** An attacker obtaining `distributor.json`, or a local attacker able to run the process as `ubuntu`, submits:

```text
Tokenkeg TransferChecked(distributor ATA -> attacker ATA, entire balance)
```

The attacker can also edit `distributions.json` to add a plausible `sig` or alter amounts. The existing detector sees no unresolved row and no distribution-specific chain anomaly. The source balance is simply gone; future runs report “no cbBTC” or pay nothing.

This is materially different from the accepted Jupiter trust hop: the distributor key directly controls the holders’ accumulated cbBTC, and there is no on-chain cap or destination restriction.

**Fix:** Scan all confirmed Tokenkeg transfers involving the distributor ATA and require every outgoing transfer to match a planned vault destination and exact amount. Record and verify the transaction signature and instruction amount from chain, not just from the local ledger. Prefer a constrained on-chain distributor program or a multisig/controlled authority. Protect the ledger directory and key with a separate OS identity; do not treat a same-user JSON ledger as an audit boundary.

---

### MEDIUM — Lock liveness is vulnerable to PID reuse and future timestamps

**Construct:** `bank/lock.mjs`, `acquireLock()` / `pidAlive()`.

A stale lock is considered live whenever:

```js
process.kill(pid, 0)
```

succeeds. The lock contains only a PID, timestamp, and random token. It has no boot identifier or process identity.

**Failure/exploit:** After a host reboot, or after the original process exits and the PID is recycled, a stale lock can contain the PID of an unrelated process. `pidAlive()` returns true and the money job refuses to run indefinitely until that unrelated process exits. This creates an outage with no automatic recovery; the current message instructs a human to kill/remove the lock.

A local user able to write the lock file can also place a valid-looking old lock with a future `at` timestamp. `age < staleMs` remains true while the system clock is behind that timestamp, so the job refuses to run until wall-clock time catches up.

**Fix:** Include a boot/session identifier (`/proc/sys/kernel/random/boot_id`), process start time from `/proc/<pid>/stat`, and preferably a host identity in the lock. Consider a bounded maximum future timestamp and page the refusal through an independent watchdog. PID existence alone is not proof that the recorded holder is the holder that created the lock.

The token-protected release and `wx` replacement race are directionally correct, but they do not solve identity or liveness.

---

### MEDIUM — The test suite does not exercise the production 20-hour distribution lock or the real ledger/write failure paths

**Construct:** `tests/3prog.test.ts`, `bank/distribute.mjs --selftest`, and `run-tests.sh`.

The suite runs the on-chain programs and synthetic detector tests, but it does not invoke the distribution process against a mocked/fault-injected RPC and filesystem. The selftest covers `allocate()` and `paymentState()` only. The 217-assertion floor therefore proves neither:

- crash after a transfer lands but before the ledger save,
- refused transfer followed by retry,
- missing/malformed vault ATA handling,
- partial DAS results,
- concurrent lock acquisition around the actual money loop,
- ledger write/rename/marker failures,
- notification failure preserving state.

**Impact:** The most consequential code path is structurally untested despite the assertion floor. A green run can still certify a payout implementation whose failure behavior differs from the pure helpers.

**Fix:** Add an integration harness with fake RPC responses and injected failures at every external boundary. Run two concurrent distributors, force confirmation timeouts after a landed transfer, return absent/malformed/foreign accounts, truncate writes, fail marker creation, and verify ledger/state plus retry behavior. Make the runner require those integration assertions, not merely the pure-function floor.

---

## Additional issues observed

- `readConfigs()` validates owner/discriminator, but `revenue.mjs` and `distribute.mjs` still read MINT config using unchecked raw offsets without verifying owner, discriminator, or version. A stale/incorrect account layout can silently produce an incorrect treasury, operator, reserve, or collection rather than a loud refusal. Use the same canonical validated reader or duplicate all validation deliberately.
- `detectDistribution()` suppresses `distribution_missed` when `days` is empty. An existing `{days:{}}` ledger after a failed first run is therefore treated as quiet rather than as a missed day. The condition `Object.keys(days).length` should not gate the outage check once the marker says the ledger has been used.
- The Jupiter operational instruction is insufficient as a security control: “hold nothing but the cycle’s own funds” is not enforceable, and the wallet necessarily holds fee SOL and may hold prior cbBTC. A malicious swap response can include allowed Tokenkeg/System instructions transferring those balances. This remains an accepted trusted-hop limitation, but the operational rule must require a fresh per-cycle wallet or an independently verified transaction instruction allowlist; merely documenting a balance expectation is not enough.

## I COULD NOT BREAK

- The on-chain MINT lifetime cap, per-round cap, bounded round duration, and governance monotonic execution checks from the supplied code.
- The SEAL requirement for owner and Bank signatures, the top-level open/close pairing, and the reserve delegate/close-authority checks.
- The BURN reserve ATA checks and its refusal to treat absent declared accounts as empty.
- The `split_revenue` destination PDA derivations and its exact remainder arithmetic.
- The new `wx` lock creation and token-checked release in the ordinary non-reboot case.
- The `readTokenAccount()` distinction between absent, foreign, malformed, and readable accounts.
- The tested Core royalty encoding path, based on the supplied real-Core assertions.

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Implement chain-derived reconciliation for **distribution outputs**, and make missing/poisoned vault accounts blocking, persisted faults rather than console warnings. Today the distributor key can move the entire customer pool while the alarm trusts a same-user mutable ledger, and the payout loop can silently omit vaults while reallocating their share.