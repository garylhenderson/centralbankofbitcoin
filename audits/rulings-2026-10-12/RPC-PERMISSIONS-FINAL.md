# Narrow delta audit: `go-live.sh` and `configure-rpc.py`, after the RPC permissions re-triage

I read both files and `configure-rpc.test.py` in full, plus `.gitignore`. I ran nothing. Every pm2 behaviour below is inferred from the CLI, not observed.

## Status of the claimed deltas

| Claim | Where | Verdict |
|---|---|---|
| M1: lock taken before the checks | `go-live.sh:11-12` | **Done.** The lock is taken before the HEAD and tree checks. `.cache` is gitignored (`.gitignore:8,14`), so the lock file itself does not make `verify_source` fail. |
| M1: clean HEAD checked before sudo and before pm2 | `:34` → `:35`; `:53` → `:54`; `:63` → `:64` | **Done.** A small time-of-check/time-of-use window remains between the check and the use. That is the residual you accepted onto the runbook. |
| L1: `set +e` in the handler, independent failure reporting | `:36-51` | **Done.** `trap - ERR` comes first, and each step has its own `\|\| echo`. |
| L1/L6: a stopped definition is preserved | `:32-33`, `:40-46` | **Done in the logic, but unverified.** It assumes `pm2 describe` exits non-zero when the app is missing. If it exits 0, rollback runs `pm2 stop` on a brand-new app instead of deleting it, and `pm2 save` then keeps that definition. |
| L1: trap cleared before publication | `:62` | **Done.** See finding B for a side effect. |
| Binary restore | `configure-rpc.py:57`, `:44` | **Done.** Covered by `test.py:80-86`. |
| Explicit UTF-8 | `configure-rpc.py:20`, `:44` | **Partial.** See finding D. |
| `main()` uses the `ENV` constant | `configure-rpc.py:66` | **Done.** |

## Findings

### A. Medium (fix before first execution, not a commit blocker): rollback runs the changed file as root when the source-change check fails
- **Where:** `go-live.sh:53` and `:39`.
- **Failure path:**
  1. Another session edits `web/deploy/configure-rpc.py` after the check at `:34`.
  2. `verify_source` at `:53` correctly fails, and that fires the ERR trap.
  3. `rollback` then runs `sudo /usr/bin/python3 -I web/deploy/configure-rpc.py --restore …` from the working tree, which is exactly what the check just flagged as unreviewed.
- **Why it matters:** detecting a changed tree is the trigger that makes root run the changed code. This path is new: it exists because the check at `:53` now sits inside the trap's range.
  - If the edit was half-finished (for example a syntax error), the restore fails. nginx is left with the new `/rpc` block while the relay is deleted or stopped, and the operator only sees the "operator recovery required" line.
- **Fix (either one):**
  - In `rollback`, run the working-tree restore only if a non-fatal `verify_source` passes. Otherwise print the exact manual restore command and skip that step.
  - Or, at `:34`, write the reviewed file to a temp file with `git show "$head":web/deploy/configure-rpc.py`, and use that same path for both `:35` and `:39`. Check first that sudoers allows that path.

### B. Low: a failed publish leaves the relay running but not saved in pm2, while the new nginx config persists
- **Where:** `go-live.sh:62-65`.
- **Failure path:**
  1. The trap is cleared at `:62`.
  2. Then either `verify_source` fails at `:63` or `publish-ecosystem.sh --execute` fails at `:64`.
  3. `set -e` exits before `pm2 save` at `:65`.
  4. The `/rpc` block in the nginx site config is on disk and was reloaded, but the relay is not in `dump.pm2`.
- **Consequence:**
  - On a first install, a reboot leaves `/rpc` pointing at port 8789 with nothing listening, so it returns 502.
  - `reboot-prep.sh` would catch the dump drift, but only if the reboot goes through it.
- **Fix:** move `pm2 save` to just before `trap - ERR`, after the public check at `:59` passes. A save failure there rolls back cleanly before anything is published. This also settles the original L1 point that a late save failure rolled back a good release.

### C. Low (conditional): the lock descriptor can be inherited by a newly spawned pm2 daemon
- **Where:** `go-live.sh:11`, then `:31` and `:54`.
- **Failure path:**
  1. fd 8 is opened without close-on-exec.
  2. If the ubuntu pm2 daemon is not already running, `pm2 pid` at `:31` spawns one.
  3. Node/libuv does not close inherited descriptors, so the long-lived daemon keeps the lock.
  4. Every later `--execute` then refuses with "Another relay release is running" until pm2 is killed.
- **Fix:** add `8>&-` to each `pm2` invocation, or require `pm2 ping` to succeed before taking the lock.

### D. Low: the "explicit UTF-8" claim does not cover the nginx and zone paths
- **Where:** `configure-rpc.py:67`, `:70`, `:80`, `:96`.
- **What happens:** these lines still use `read_text()` with no arguments, which means locale encoding plus universal newlines.
  - A CRLF site file is silently rewritten as LF on every run. Restore stays byte-exact, so this is not a rollback defect.
  - Under a non-UTF-8 locale that sudo keeps (`LANG`/`LC_*`), non-ASCII bytes in the site file are decoded with the wrong codec and written back as UTF-8.
- **Fix:** use `read_text(encoding='utf-8', newline='')` at those lines, or compare and write bytes.

## Missing verification
- **Test count does not match the "nine tests" claim.** `configure-rpc.test.py` defines **ten** test methods (`:32, 45, 50, 55, 59, 63, 70, 77, 80, 87`). Either a test was added after the run that was reported, or one did not run. Re-run the suite under `sudo /usr/bin/python3 -I` and record the count.
- **Nothing exercises the `go-live.sh` deltas or `main()`.** The new lock ordering, `verify_source` placement, rollback branches (running, stopped, absent) and trap clearing are all unrehearsed. Specifically unconfirmed:
  - the exit codes of `pm2 pid` and `pm2 describe` for a missing app;
  - that `pm2 pid` prints `0` for a stopped app;
  - one forced failure at `:56` to prove the handler gets all the way to its final message.

## Commit readiness
- **`configure-rpc.py`:** no new blocker. D is hardening.
- **`go-live.sh`:** ready to commit as source. Before any execution, fix A, and preferably B, because both are small.
- **Out of scope:** I found no other concrete new blocker. I did not re-audit the items you deferred to the runbook (immutable deployment, the env parser, real-IP scoping).
