I've finished reading the scoped files. The one file I couldn't read was `/opt/gary-club/scripts/cbob-reconcile.mjs`, because it's outside this session's allowed directories. I'm writing the report now.

# A5 job-isolation audit: `6bd31f8e` against baseline `92197156`

This is a source review only. I ran no commands, tests or git operations. I haven't verified the operator's test results, and I'm not calling the deployment accepted. I couldn't inspect host state: file modes on `/opt/cbob-vaults`, `/opt/gary-club` and `/scratch/cbob-vaults-cache`, whether `.cache` is a symlink, or where `node_modules` points.

**Verdict: no source-level blockers in the direction of the design. Three should-fix items before the real migration, and one condition on the install itself.**

## What holds up
- **Credential scoping.** `select_env` copies named keys only. It rejects duplicate, missing and empty values.
  - The producer file excludes the wallet key, the mail key, `CRON_SECRET` and `CBOB_PORTAL_HOLDER_ACTIONS_ENABLED`.
  - The recovery file holds `CRON_SECRET` alone.
  - The test for the producer file would fail if `CRON_SECRET` leaked into it.
- **Financial flags.**
  - The installer refuses to run if either flag is `1` in the env file, and again if either is `1` in the running PM2 process.
  - It never writes a flag, so it cannot enable either one.
  - It copies the trading flag into the producer file only to label public status.
  - `market-index.mjs:144` reads it as `=== '1'` for labelling only. The doc says a mismatch can mislabel but cannot enable settlement.
- **State and lock preservation.**
  - The installer copies state under the original flock, validates the whole tree (no symlinks, no hard links) before any `chown`, and leaves the old cache untouched.
  - It `fchown`s the lock in place, so it's the same inode.
  - The state-root overrides use `CBOB_DATA_STATE` with the old path as the default, so an `ubuntu` fallback still reads the old cache.
  - All three state paths are covered: `vault-index`, `vault-meta-state.json` and `market-sale-times.json`.
- **Installer rollback.** It removes only its own drop-ins, reloads systemd, and restarts only the timers that were active before. It refuses to replay. It keeps the new state, scoped credentials and identities, and says so.
- **Identities.** `ensure_identity` checks for a non-root uid, nologin shell, `/nonexistent` home and no extra groups.
- **Test counts.** I counted 7 groups in `job-isolation.test.py` and 5 checks in the sandbox fixture, and I counted 17 `ok` lines in the deploy test. The `17/17` in the deploy test is a hard-coded string, not a computed count.

## Should-fix

1. **A timeout can leave the isolated first-refresh transient running.** `activate-public-data.py:76-77`
   - The outer 490s limit kills only the `systemd-run` client with `killpg`. That doesn't stop the transient unit.
   - Normally `RuntimeMaxSec=480` ends it first, and `--wait` then returns cleanly. The margin is about 5s, with `TimeoutStopSec=5` on top.
   - If the client hangs, or the transient outlives the margin, `activate()` restores the predecessor and the lock is released while a `cbob-data` writer may still be running. That's the predecessor-restore race you asked about.
   - Fix: give the transient a fixed `--unit=` name. On timeout, run `systemctl stop` on it and confirm it's inactive before the rollback restores the predecessor. Also pass `stdin=DEVNULL`, because `--pipe` forwards stdin.
   - No test exercises the isolated first-refresh branch. The "hung refresh is killed" test covers a plain process only.

2. **Sibling secrets may still be readable inside the namespace.** `ProtectHome` hides `/home`, but the public-data conf leaves `/opt/cbob-vaults` and `/scratch/cbob-vaults-cache` readable, and the reconcile conf leaves all of `/opt/gary-club` readable. Only `.env.local` is replaced.
   - The producer must traverse the first two to reach the lock. `selftest.mjs` shows the Bank tree holds keys, backups and a ceremony cache.
   - The reconcile user reads the whole app tree, which may include other `.env*` files or PM2 config.
   - Before install, confirm none of those are world-readable. Better, add `InaccessiblePaths=` or `TemporaryFileSystem=` for the unneeded subtrees. A dedicated lock directory would make that easy.
   - The fixture never tests this.

3. **The reconcile template and the production mounts are untested.**
   - The sandbox fixture loads only `public-data-isolation.conf`, and it strips `User`, `Group`, `BindReadOnlyPaths`, `ReadWritePaths` and `Environment`.
   - So the real `/scratch/.../public-data.flock` file in `ReadWritePaths`, the `/opt/gary-club` file bind mount and the real identities are untested. The installer's own run of both services is the first real test, and a failure there rolls back.
   - Add the reconcile template to the fixture.
   - I couldn't read `cbob-reconcile.mjs`, so I can't confirm it works as `cbob-reconcile` with a read-only filesystem and `UMask=0077`.

**Condition on the install:** the lock path is written two ways. The installer, `pin-public-data.sh` and the service use `/opt/cbob-vaults/.cache/public-data.flock`, but `ReadWritePaths=` uses `/scratch/cbob-vaults-cache/public-data.flock`. This is only correct if `.cache` is a symlink to `/scratch/cbob-vaults-cache`, which `install-ceremony.py` suggests. Confirm that first. If it's wrong, the flock open in the isolated service fails, and the installer's rollback catches it.

## Accepted residuals
- **No path to update the isolation config.**
  - The installer refuses once `90-isolation.conf` exists.
  - `first_run` refuses any source whose `public-data-isolation.conf` differs.
  - So a future conf change needs a new reviewed updater. Future source-only publishes work, because the first refresh runs the new source under the sandbox and rolls back if it fails.
- **Rollback leaves ownership changed.** Output directories stay `ubuntu:cbob-data` with mode 2775, and the lock stays `ubuntu:cbob-data` with mode 0660. The old `ubuntu` producer still works, as documented. The new state directory is not reconciled back into the old cache.
- **Group write on the output directories and lock.** The recursive `controlled_tree` makes every existing file in `data/` and `v/` `ubuntu:cbob-data` with mode 664. Check that those directories hold nothing unrelated to the producer. A compromised producer could also hold the shared lock.
- **Database service-role key.** It stays broad in the producer file, as documented.
- **No network egress filter.** `AF_INET` stays open, so the jobs can reach the loopback app and, on AWS, the instance metadata service. Consider `IPAddressDeny=169.254.169.254` or confirm no instance role exists.
- **No hardening beyond the listed directives.** There is no `ProtectProc`, `PrivateDevices` or `SystemCallFilter`. The `ReadOnlyPaths=/run` fix covers file writes, not connecting to sockets.
- **Trading flag copy must be updated by hand.** The producer's `CBOB_PORTAL_TRADING_ENABLED` is manual and documented. Nothing automated compares it with the live switch.
- **Real first-run proof is still pending.** The first end-to-end run of both services under the new identities happens only at the real install.

I changed no files, and I did not run, commit, push or pin anything.
