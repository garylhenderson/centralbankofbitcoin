# Audit report: `signing-clean-test-user.py`, `CredentialCleanupTests`, and the final paragraph of `SIGNING-DELIVERY-2026-10-12.md`

I only read the assigned files. I read no credentials, ran nothing and edited nothing.

## Blockers

### B-1. A reboot inside the 15-minute window can leave the test login in place forever (Medium–High)
- **Where:** `SIGNING-DELIVERY-2026-10-12.md:202-208` and Stage 2 step 6 (`:117-123`).
- **What goes wrong:**
  1. A plain `systemd-run --on-active=15m` creates a temporary timer that does not survive a reboot.
  2. The steps run in this order: schedule the timer, append the test user, then the box reboots, crashes or OOMs (which kills the automation) before `finally` runs.
  3. The test user stays in `/etc/nginx/cbob-mainnet-ceremony.htpasswd` and nothing removes it.
  4. The signing vhost does refuse after a reboot because the runtime marker is gone. But the next owner window reuses this same htpasswd file (`:90`), so the leftover login becomes valid again when that window opens.
- **Second gap:** the timer fires once. If that one run fails, there is no retry. One example is the helper exiting 1 because the file was swapped for a symlink. Either way the doc's own rule "Never leave a test credential enabled" is broken.
- **Fix:**
  - Add a sweep mode that removes every line matching `^cbobverify_[a-f0-9]{24}:`. Gary's entry can never match it.
  - Run that sweep at three points: from `signing-refuse.py` (which already runs on startup, stop and post-stop), before activation, and in the "repeat for real owner window" checklist.
  - Make activation refuse if any `cbobverify_` line exists before it adds its own.

### B-2. The script that adds the test user is not specified or reviewed, and the cleanup's guarantees depend on it (Medium)
- **Where:** `SIGNING-DELIVERY-2026-10-12.md:118-122`. The cleanup in `signing-clean-test-user.py:19-27` assumes a well-behaved append.
- **What goes wrong:**
  - The cleanup holds an exclusive lock on the file. Nothing requires the appender to take the same lock or to append in place.
  - Stock `htpasswd` does not take that lock and rewrites the file. Whether that preserves the inode depends on the tool.
  - **No trailing newline:** suppose the file's last line, Gary's entry, has no newline at the end.
    - A naive `cbobverify_…:hash\n` append glues itself onto Gary's line and corrupts his password hash. The cleanup then finds no line starting with `cbobverify_` and removes nothing.
    - If the appender adds `\n` first instead, the cleanup leaves that extra `\n`, so Gary's bytes are permanently changed.
  - The only test (`signing-refuse.test.py:51`) uses a file that already ends in a newline.
- **Fix:** commit and review the appender before Stage 2. It must:
  - take the same exclusive lock and append in place, preserving the inode;
  - refuse unless the file ends with `\n` and has no existing `cbobverify_` line;
  - hash the password in memory and never print it;
  - record the full-file SHA-256 in memory before appending;
  - in `finally`, assert the **whole file** matches that hash, not just Gary's line.

### B-3. The cleanup is not atomic and can briefly expose a fake login made from part of another entry (Low–Medium)
- **Where:** `signing-clean-test-user.py:25-27`. It writes from offset 0, then truncates.
- **What goes wrong:**
  - Picture the file as A + T + B, where T is the test line and B is non-empty.
  - Between the write and the truncate, the file reads as A + B + (the last `len(T)` bytes of B).
  - Those leftover bytes can form a valid-looking entry, for example `ry:<Gary's hash>\n`.
  - nginx re-reads `auth_basic_user_file` on every request, so it can see that state. So can anything that sees the file if the process is SIGKILLed in that gap.
  - The intended flow appends T last, so B is normally empty. But duplicate or overlapping runs, or a later edit, break that assumption.
- **Fix:** allow removal only of trailing `cbobverify_` lines, done as a single `ftruncate(fd, len(prefix_bytes))`. If a test line sits anywhere else, refuse loudly and exit non-zero. Also skip all writing when nothing would change; today it always rewrites, see `:23-29`.

### B-4. The symlink check and file open can race, and the file type and owner are never checked (Low)
- **Where:** `signing-clean-test-user.py:17-19`.
- **What goes wrong:**
  - `is_symlink()` followed by `open()` is a check-then-use race.
  - A FIFO or device at that path would block the helper or be written to.
  - Ownership and mode are never asserted before writing.
  - `/etc/nginx` is root-only, so the practical risk is low.
- **Fix:** open with `os.open(path, O_RDWR|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK)`. Then use `fstat` to require a regular file with uid 0, gid www-data and mode 0640, and refuse otherwise.

## Missing verification

1. **Tests** (`signing-refuse.test.py:44-63`). None of these cases are covered:
   - a file with no trailing newline;
   - a test line in the middle of the file;
   - a symlink or non-regular file being refused;
   - a different `cbobverify_` user being preserved, which the name-only mode should do;
   - an untouched file when nothing needs removing;
   - `__main__` refusing a non-root caller or the wrong number of arguments;
   - a whole-file byte comparison against a real copy of Gary's line, as opposed to the synthetic `gary:unchanged-hash`.

   Also, uid/gid preservation is only checked for the test runner's own user, never root:www-data.
2. **"Verify the timer exists first"** (`:208`) does not say how. The procedure should:
   - use a fixed `--unit=cbob-clean-<username>`;
   - check `systemctl show` for the timer: active, with a next-elapse time set;
   - check that the service's ExecStart argv is exactly `/usr/local/libexec/cbob-signing-clean-test-user.py` plus the exact username;
   - check the installed helper's SHA-256 against the reviewed commit before scheduling.
3. **The `-I` flag:** the `#!/usr/bin/python3 -I` shebang only applies when the file is executed directly. The doc should require `systemd-run` (and `finally`) to run the installed path itself, or `/usr/bin/python3 -I <path>`, never `python3 <path>`.
4. **"Passwords never in argv" covers the HTTPS checks too.** `curl -u user:pass` exposes the password through `/proc/<pid>/cmdline` until curl blanks it. The checks should pass credentials with `--config -` over stdin, or a netrc on an inherited file descriptor. This should be stated and checked.
5. **Removal is never confirmed.** The helper exits 0 when the user is already absent. The `finally` step needs to assert three things: no `cbobverify_` line remains, the whole-file hash matches the recorded one, and the removed test user now gets 401. The last item is already in the doc at `:123`.

## Disposition
Hold Stage 2 step 6 until B-1 and B-2 are fixed: a cleanup sweep that survives reboots, and a reviewed, committed appender.
