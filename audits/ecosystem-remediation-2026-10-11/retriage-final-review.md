**Verdict: B1 and S1 are resolved, and I found no new blocker.** The pins can be accepted, on the condition that the real first refresh reports a pass (finding N1 below). Publication with holder actions closed is ready, pending owner approval.

I used 4 of my 5 reads: the patch, `activate-public-data.py`, `run-public-data.py`, and one grep of `web/` (excluding `node_modules`).

### B1 (process-group kill): resolved
- At `activate-public-data.py:10-11`, `Popen(..., start_new_session=True, user='ubuntu', group='ubuntu', extra_groups=[])` makes Python call `setsid()` in the child before it drops privileges. So the refresh's pid is its group id, and no wrapper sits in between to start a second session.
- `run-public-data.py:22` calls `os.execv('/usr/bin/node', …)`, so Node keeps the same pid and group. The earlier `git` and `check-public-data-dependencies.mjs` subprocesses (lines 6, 14) are children in that group, so `killpg` at line 18 reaches all of them.
- `killpg` runs before `proc.wait()`. The timed-out leader has not been reaped, so its group id cannot be reused by another process. No race.
- The fixture asserts uid, gid, an empty group list, `pid == pgid == child pgid`, and that no non-zombie survives the timeout. That covers the B1 path.
- The grep found no remaining `runuser` in `web/`.

### S1 (founding-cohort wording on buy): resolved
- `buy.html` now says no vault, including one bought in the first sale round, can join the payout pool earlier than thirty days after charter close.
- All three pages (buy, claim, and the cbob-2026-2 correction) now say "first payout that requires no $GARY burn" instead of promising an automatic caller.
- The grep found no remaining "first automatic payout" anywhere in `web/`.
- Claim keeps "founding cohort", which is right because claim only issues charter vaults.

### Not blocking, but verify before relying on the pin

**N1 (Low–Medium, operational): the first refresh runs with root's environment.**
- **Cause:** `Popen(user=…)` changes the uid, gid and groups but leaves the environment unchanged. The child keeps `HOME=/root`, `USER=root`, `LOGNAME=root` and whatever variables `pin-public-data.sh` exports. The removed `runuser -u` used to set `HOME`, `USER` and `LOGNAME` to ubuntu.
- **What could fail:** `git` at `run-public-data.py:6` runs as ubuntu with `HOME=/root`.
  - It cannot read `/root/.gitconfig`. Depending on the git version, that is a warning or a fatal error.
  - Any `safe.directory` entry in `/home/ubuntu/.gitconfig` will not be read. If `/opt/cbob-public-data/<sha>` is not owned by ubuntu, git refuses with "dubious ownership".
  - Node may also look under `$HOME`.
- **What happens if it fails:** the activation fails closed and the previous override is restored. But `activate()` deliberately leaves the new base unit in place. If there was no previous override, the public-data producer stays disabled and public data goes stale until someone steps in.
- **Why the fixture doesn't cover it:** it runs `sys.executable -c …`, not the real runner (git, dependency check, then `execv` Node). So it proves identity and kill behaviour, not that the timer's environment matches.
- **Fix:** pass an explicit environment to `Popen`, for example `env={'HOME':'/home/ubuntu','USER':'ubuntu','LOGNAME':'ubuntu','PATH':'/usr/bin:/bin'}` plus whatever the unit's EnvironmentFile supplies. Optionally add `cwd=source`.
- **Minimum verification:** the real `pin-public-data.sh` run prints `Public-data first refresh passed`. Treat anything else as "pin not accepted".

**N2 (Info):** on a normal exit, the group is not swept for leftover children. The runner's subprocesses all run with `check=True` and finish before the exec, so nothing is leaked today. Keep it that way if the runner changes.

There are no concrete blockers. The pin is accepted conditionally on the real first refresh passing, which the script reports itself; fixing N1 first is advised. Publication with holder actions closed is ready pending owner approval.
