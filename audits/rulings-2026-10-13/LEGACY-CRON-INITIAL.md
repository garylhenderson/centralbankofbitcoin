**Verdict:** I found no source blocker for the unprivileged logic, but there are three gaps I'd close or check before applying. I only read the five files statically. I did not read the crontab or env, and I did not run anything. The test results, the in-memory transform on the real crontab and the HEAD 405 are the operator's evidence, not mine.

**Should fix or verify before `--execute`**
1. **The transformer never checks that the old line uses `CRON_SECRET`.** The check at `cleanup-legacy-crons.py:18` only looks for `curl `, `Authorization: Bearer `, the `.env.local` path and the URL. The Node caller (`reconcile-notices.mjs:6`) accepts only a single `CRON_SECRET=` line.
   - If the old command read a different variable or file format, the new job would get a 401 every hour. The only trace is a "failed" line in a private log, and Notice reconciliation would silently stop.
   - The operator can check this with a one-time static comparison of variable names, with no secret values printed. Better, add `'CRON_SECRET' in line` to the transformer check.
   - The test fixture uses a fake `$(read ...)`, so it doesn't cover this.
2. **Nothing verifies `/usr/bin/node`.** The replacement line hardcodes that path. If node comes from nvm or another location, or is older than 18, the replacement fails silently. Add an `os.access('/usr/bin/node', os.X_OK)` check, and ideally a version check, before the CAS step. The script uses `fetch`, `AbortSignal.timeout` and top-level await, so it needs a recent Node.
3. **The cron job runs from the `/opt/cbob-vaults` working tree.** If anyone later checks out a branch that lacks `web/deploy/reconcile-notices.mjs`, the Notice job breaks silently. The script also requires `origin/v6` to equal the reviewed SHA (`:26`), and the doc doesn't mention that branch. Confirm the `/opt` checkout tracks v6 and that this commit is pushed there, not only to `cbob-launch-week`. Consider noting the dependency in the doc.

**Minor**
- **One line matching both predicates:** such a line (`distribute.mjs` plus the reconcile URL) would be counted in both `remove` and `replace`. The output loop would then drop it and leave only the other lines, with no error. The counts check passes only if no other lines match, so the risk is low, but add `check(not set(remove)&set(replace))`.
- **Not atomic:** the `crontab -l` re-read and the `crontab FILE` install (`:40-41`) leave a small race window. That's acceptable and the doc says so. The read-back at `:42` does catch a mismatch.
- **Stray backups:** backups are written before the log-safety checks, so a refusal leaves unused private directories. This is harmless.
- **Hardcoded uid:** `uid==1000` is hardcoded. This is fine if ubuntu is 1000.
- **Errors carry no status code:** failures log a generic line with no HTTP status, which makes diagnosis hard. That matches the "log nothing sensitive" intent. A numeric status would be safe to add.
- **Timeout equals `maxDuration`:** the 300s timeout equals the endpoint's `maxDuration`, so a run near the limit is aborted client-side. That behaves the same as a server kill, and there are no retries. I did not check the endpoint source, so `maxDuration`=300 is the operator's claim.

**Test gaps (`legacy-crons.test.py`, `notice-caller.test.mjs`)**
- The Python test has no cases for a commented-out duplicate, a missing trailing newline, a line without `CRON_SECRET`, or one line matching both predicates.
- The Node tests cover secret selection, a single POST with `redirect:'error'` and no retry. They don't cover a timeout abort or the `import.meta` main-guard path. These are not blockers.

**What I confirmed from the source**
- The script never invokes the HTTP job. It has no HTTP call and only `crontab`, `git` and `sudo install` subprocesses.
- Unrelated lines are preserved byte-for-byte, because the transform uses `splitlines(keepends=True)`.
- Private 0700/0600 backups, the clean-HEAD/pushed-SHA gate, the missing-target check and the log symlink/ownership checks are all present.
- The Node caller sends the secret in-process in a header, never via argv. It uses the existing route and POST, doesn't follow redirects and doesn't log the body.
- The doc's A5 caveat is accurate, and nothing here touches the approved isolation batch.
