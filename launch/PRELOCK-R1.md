# R1: fresh tests against exact live Core

Owner ruling: `launch/RULINGS-2026-10-11.md`. Lock target Friday 16 October
2026 noon Austin time (17:00 UTC). The certification window begins Thursday
15 October noon Austin time. No job is armed by this document. An early plumbing rehearsal is available as
`prelock-check.sh --rehearse --commit FULL_REVIEWED_SHA`; it runs the same suites
but writes under `.cache/prelock-rehearse`, produces a rehearsal-only result and
cannot be accepted by the certification verifier.

Run from the clean, reviewed, pushed production source:

```
bash scripts/prelock-check.sh --run --commit FULL_REVIEWED_SHA
```

It refuses outside the window, takes the shared validator lock, verifies live
Core from finalized mainnet data against the committed pin, and runs:

1. The canonical full suite with `CBOB_SHIP_GATE=1`, including the live mainnet
   facts and real-pool swap fork. No network skip may certify the lock.
2. The Test Vault simulation.
3. The holder end-to-end localnet suite.

Two independent providers must agree on live Core and all five Bank programs,
including their deployed bytes and upgrade authorities. It reads them again,
checks their bytes, authorities and upgrade slots did not change,
and writes a private receipt with source commit, times and log fingerprints.
Any failure leaves no passing receipt. The existing Core watcher diagnostic
runner is deliberately not used for certification: it bypasses the mainnet
probe while measuring a changed Core build.

Immediately before the separately authorized lock:

```
node scripts/prelock-receipt.mjs --verify /var/lib/cbob-prelock/run-RECEIPT --expect RECORDED_SHA256
```

Use the actual root-owned archive and digest printed by the run. Record that
digest outside the box; verification requires it and re-checks the raw exit
statuses, exact floors, before/after observations and every evidence file. This re-reads live Core and refuses
stale tests, changed source, altered logs or a changed Core upgrade slot, even
if the program bytes changed and later reverted. It never signs or locks.

Also require all of the following operational checks:

- The independent `scripts/verify-ceremony.mjs --after <recorded-collection>` read-back passes.
- The existing Core watcher cron is enabled, its last read is recent, it has no
  unreadable streak, and its existing alert/re-test path remains enabled.
- The holder guide's dependency disclosure is published where holders read it.
- No unresolved signing, program, custody or launch blocker remains.
- The owner explicitly authorizes removal of the five upgrade authorities.

If Core differs from the pin, do not override the hash or bypass the probe.
Preserve the fresh observation, let the watcher run its diagnostic, review an
explicit re-pin, commit it, and repeat the full certification within the window.
If it cannot pass, do not lock. Postponing the alarm deadline requires a new
owner ruling and reviewed commit; otherwise the production alarm correctly
continues reporting the overdue lock. An already initialized charter date is permanent;
the Bank's UI switch does not stop direct on-chain claims. Escalate to Gary.

After each authority removal, independently verify that authority is absent.
The automatic watcher stays on after launch: locking our programs does not lock
Metaplex Core. A passing test does not guarantee a later upgrade is compatible.
