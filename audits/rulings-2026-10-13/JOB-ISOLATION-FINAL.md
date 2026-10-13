# Final triage: `/scratch/cbob-job-isolation` at `e09fed9a`

This is a source read only. I ran no commands or tests and touched no network or secret files. I did not measure the operator's test results or the SHA256 `af31aca9…`. The caller copy was read as text, so I haven't confirmed it is byte-identical to what is deployed.

**Verdict: the three earlier should-fix items are resolved at source level. I approve the scoped migration, subject to the live proof and one new should-fix (the caller hash pin, item 1 below), which should land before install.** I found no blockers.

## Earlier should-fix items

- **Transient shutdown.** `run_isolated_refresh` (`activate-public-data.py:30-46`) uses a named unit and runs `systemctl stop` in `finally`. It then reads `ActiveState` back and accepts only `inactive` or `failed`.
  - A timeout, a stop error, a `show` error or an active state all raise `RefreshStillRunning`.
  - That branch requests a timer and service stop.
  - `activate()` turns it into `RollbackFailed`, so the predecessor is not restored.
  - `stdin` is `DEVNULL`.
  - A collected or nonexistent unit reads as `inactive`, which is correct.
  - The real timeout fixture with a descendant covers the main case. The two mocked cleanup and order cases cover the failure paths.
- **Sibling secrets.** Both configs now mount an empty `TemporaryFileSystem` and bind back only what is needed.
  - Public data gets the narrow env file, `node_modules`, `.git` and the lock.
  - Reconcile gets the narrow env file and the caller only.
  - `InaccessiblePaths=-` covers the ceremony and backup trees.
  - The fixture makes sibling secrets world-readable and checks they are hidden.
- **Reconcile template untested.** Both templates now run in the namespace fixture.
  - The fixture asserts the same lock inode and that the original host env is unchanged.
  - Output is writable for public data only.
  - Hiding the cache is not a problem. The lock bind goes through the masked `.cache`, and the installer now enforces the `.cache` symlink target (`install-job-isolation.py:74`).

## Caller copy: `reconcile-caller-reviewed.mjs`

I read it and it is acceptable.
- It imports only `node:fs`, so it needs no `node_modules`.
- The `CRON_SECRET` parsing matches the installer's `select_env` format, including quote stripping.
- It posts to loopback `:3003` with a 55s timeout, under the unit's 58s limit.
- It never logs the secret and prints only counts.
- The exit code is 1 on any failure.

## Remaining should-fix

1. **Pin the caller's hash in the installer.** The bind mounts whatever is at `/opt/gary-club/scripts/cbob-reconcile.mjs`, and that file is not in the repo. The installer never compares it with the reviewed copy.
   - That means the file that receives `CRON_SECRET` is unreviewed as far as the installer can tell.
   - Add a check against the reviewed hash, or commit the file and install it.
   - Do this before install, and have the installer measure the hash itself.
2. **Deny the IPv6 metadata address too.** `IPAddressDeny=169.254.169.254` covers IPv4 only, and `AF_INET6` stays open. Add `fd00:ec2::254`, or confirm IMDSv6 is disabled on the instance.
   - The fixture also doesn't assert the IPv4 deny, so either check it live or add an assertion.

## Live checks (not proven by source)

- **Property conversion.** `activate-public-data.py:96` passes the conf lines to `systemd-run --property=`. That includes multi-value `TemporaryFileSystem=`, colon-style `BindPaths=` and empty `SupplementaryGroups=`. The fixture builds its properties by a separate path, so the real first refresh on the production conf is the first proof of this.
- **Layout.** The fixture uses `/run` paths. Production uses `/opt`, `/scratch` and `/var/www`. The installer's own run of both services is the real test.
- **Hidden Bank tree.** The producer must not need any Bank files other than `.git`, the source worktree and the lock. Only a live run shows this.
- **Rollback and umask.** `UMask=0022` means new output files are `cbob-data` 0644. After a rollback, the old `ubuntu` producer can replace them by rename but not write them in place. This is the same residual as before.
- **Failed rollback.** If rollback fails, the `finally` block still restarts the timers. Check unit state manually in that case.

## `RELEASE-ACCEPTANCE.md` and `JOB-ISOLATION.md`

- **Release checklist.** It matches your description.
  - It keeps real login, connect and wallet checks before signing.
  - Mainnet claims are gated to Oct 19 noon Austin.
  - Supervised release approval is explicit.
  - It uses no fabricated mainnet actions.
- **Job isolation doc.** The boundaries and timeout wording match the code.

I changed no files and ran nothing.
