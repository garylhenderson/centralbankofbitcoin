**Verdict: the install condition is closed. I approve the scoped migration and see no remaining blocker.** This is a static read of the delta only. I computed no hash and ran no tests. The operator's 9 isolation groups, the two systemd fixtures and the transient timeout run are their results, not mine.

**Items from my last review**
- **Caller hash pin:** this is resolved.
  - `install-job-isolation.py:17` defines `CALLER_SHA256`, and it matches the value you quoted when I compare the two strings.
  - Lines 76-77 call `normal(caller)`, which uses `lstat` to require a regular file with one link and no symlink. The installer then hashes `read_bytes()` itself and compares.
  - Both checks run before any mutation. The first mutation is `systemctl stop` at line 108, and the first receipt write at line 106 is also after them.
  - I did not re-read the original caller copy, so I haven't confirmed the pinned hash corresponds to the bytes I reviewed earlier.
- **IPv6 metadata deny:** this is resolved. Both `reconcile-isolation.conf:10` and `public-data-isolation.conf:13` now say `IPAddressDeny=169.254.169.254 fd00:ec2::254`. I did not review the tests, so I haven't checked whether they assert the deny.
- **No timer restart after failed restoration:** this is resolved.
  - The `except` around restoration sets `resume=False` at line 148 before raising.
  - The `finally` at line 154 skips the timer restarts, so both timers stay paused for manual recovery.
  - The successful-rollback path keeps `resume=True`, so the previously active timers come back.
- **`JOB-ISOLATION.md`:** it matches the code on the reviewed recovery-caller hash, the IPv4 and IPv6 metadata denial, and the failed restoration leaving both schedules paused.

**Non-blocking residuals**
1. **The pin only covers install time.**
   - The hash is checked once, at line 77. Later the unit bind-mounts that path on every run, and the file gets `CRON_SECRET`.
   - The installer doesn't check that the file is root-owned or not writable by `ubuntu`, so the operator could change it after install. Before the first service start there is also a window of up to 490s while the installer waits for the jobs to go idle.
   - If it's cheap, re-hash just before the service starts, or `chown root` and `chmod 0644` the file. Also record the hash in the receipt.
   - This is a hardening step, not a blocker. The operator account is already trusted for deployment.
2. **A failed `record()` skips the rollback.** If `record()` itself fails at line 141, the override files stay installed, and the `finally` still restarts the timers with `resume=True`. That needs a disk or permission fault at that moment, so I'm not blocking on it.

**Live checks still open from last time**
- Property conversion on the production conf.
- The `/opt`, `/scratch` and `/var/www` layout.
- Whether the hidden Bank tree breaks the producer.
- Output file permissions after a rollback.

The installer's own run of both services is the real test of the first three. After install, check effective users, credential names, fresh public JSON and the unchanged hash of the original env file, as `JOB-ISOLATION.md` step 3 says.

I changed no files and ran no commands.
