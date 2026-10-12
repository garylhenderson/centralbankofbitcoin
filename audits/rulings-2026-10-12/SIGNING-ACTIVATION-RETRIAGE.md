# Audit: CBOB signing closure and activation re-triage

**What I read in full:**
- **Deploy code:** `signing-refuse.py`, `signing-refuse.test.py`, `signing-activate.py`, `signing-activate.test.py`, `cbob-signing-refuse.service`, `cbob-ceremony@.service`.
- **nginx templates:** `nginx-signing-location.conf.example`, `nginx-signing-active.conf`, `nginx-signing-refusal.conf`.
- **Plan:** `launch/SIGNING-DELIVERY-2026-10-12.md`.
- **Operational drafts:** `install-signing-delivery.py`, `verify-signing-delivery.py`.
- **Prior reviews:** `signing-closure-review.md` and `signing-test-user-review.md`.

**Narrow checks:**
- the `ssl_stapling` and `include` directive lines in `/etc/nginx/nginx.conf`;
- the installed Python version (3.10, so `crypt` is available);
- a search of `launch-ceremony.mjs` for child-process calls (none, so MainPID is the listener).

I read no credentials, env files or htpasswd, and I ran nothing.

**The working tree changed while I was reviewing.** `signing-activate.py` gained the "issuer certificate not found" warning class. `signing-activate.test.py` gained `test_warning_policy`, so there are now 8 activation tests, not 7. `nginx-signing-active.conf` gained `ssl_stapling off`, and the plan gained lines 217–219 and 234–239. This report covers those later versions. Approval applies only to a commit whose bytes match them; see I-3.

## Verdict

D1–D4 are closed as specified, and the runtime-only credential design closes B-1 to B-4. I found no remaining defect in closure or activation that can leave the route open with a dead backend, or expose a credential through the gate. What remains:
- one availability risk during the owner window (A-1);
- hygiene defects in the two operational drafts (I-1 to I-3), which should be fixed before running them as root;
- several checks that the plan promises but the harness does not perform (V-1).

None of these stops the units from being installed from a pinned commit.

## D1–D4 disposition (confirmed)

- **D1, closed.**
  - `StartLimitIntervalSec=0` is in the refuse unit's `[Unit]` section.
  - Both stop hooks run `+rm -f open auth.htpasswd` before calling the helper. A failing `systemctl start` (rate limit, or shutdown conflict) still leaves the gate removed, which also covers D5.
  - `rm` removes `open` first.
  - The harness runs six rapid closures (line 55).
- **D2, closed.**
  - `clear_runtime` runs before `acquire` (refuse lines 73–76). The wait is bounded at 5 s, and the closure clears again after acquiring the lock.
  - **Crash during activation:** the activator's second `pidcheck` happens after the crash, so activation fails and cleans up.
  - **Crash after the second `pidcheck`:** the lock is released microseconds after the marker is created. The refusal job started by ExecStop gets the lock and clears the marker.
  - Worst-case lock hold is about 48 s (four `systemctl`/`ss` calls plus `nginx -t` plus reload, each with an 8 s timeout). That exceeds the refuse unit's 5 s wait, but the gate has already been cleared before the wait, so a timeout leaves the route closed.
- **D3, closed.** The location template sets `proxy_set_header Authorization "";`.
- **D4, closed.**
  - Activation checks ActiveState and SubState, a non-zero MainPID, and exactly one `ss` line whose local address is `127.0.0.1:8790` and whose only PID is MainPID. Any IPv4 or IPv6 wildcard listener adds a line and is refused.
  - It runs the strict warning filter after writing the active vhost. The signing host's own stapling warning is now removed at the source with `ssl_stapling off`, not tolerated by the filter.
  - The marker is created with `O_EXCL|O_NOFOLLOW`.
  - Cleanup runs in `except`, after the context manager has released the flock.
- **Runtime credential design.**
  - The permanent file is opened `O_NOFOLLOW|O_NONBLOCK`, `fstat` must show root:www-data 0640 regular, and the content must be exactly one `gary:` line.
  - The verification entry is checked against a strict regex. Its expiry timer is scheduled and confirmed armed before any runtime auth is written.
  - The runtime copy is written atomically from `mkstemp` (0600, then 0640 root:www-data). The `rm` hooks, `clear_runtime` and the activation error path all delete it, and a reboot clears `/run`.
  - Normal activation from the command line can only pass Gary's bytes.

## Remaining findings

**A-1. Medium-Low (owner-window availability). A leftover verification timer can close the real signing window mid-ceremony.**
- **Where:** `signing-activate.py:143-156`. The timer is armed only in verification mode, and normal activation never checks for it.
- **How it happens:**
  1. The harness is SIGKILLed, the SSH session drops or the OOM killer runs before its `finally` stops the timer at line 94.
  2. `cbob-signing-verification-expiry.timer` is still armed for up to 15 minutes.
  3. If Gary's owner window is activated in that time, the timer fires `cbob-signing-refuse`. That clears the marker and swaps the refusal vhost in during an initialization sequence.
- **Same root cause, second symptom:** if the transient `.service` ever ends `failed`, every later `systemd-run --unit=cbob-signing-verification-expiry` fails. Verification activation then refuses until someone runs `reset-failed`. That fails safe, but it is confusing in the window.
- **Fix:**
  - In normal mode, refuse to activate if `systemctl show cbob-signing-verification-expiry.timer -p LoadState -p ActiveState` reports loaded or active.
  - In the harness `finally`, add `systemctl reset-failed cbob-signing-verification-expiry.service cbob-signing-verification-expiry.timer`.
  - Add both to the "repeat for the real owner window" checklist.

**A-2. Low. Any local user can hold `delivery.lock`.**
- **Where:** the lock is created by `open('a')` under umask 022, so it is mode 0644 (`signing-refuse.py:74`, `signing-activate.py:82`).
- **Why it matters:** `flock(LOCK_EX)` works on a read-only file descriptor. Any account (ubuntu, www-data, another DynamicUser) can open the file and hold the lock.
- **Effect:**
  - Activation times out, so the attacker gets a denial of service.
  - The refusal job clears the marker first, then exits 1 without swapping the vhost. That fails closed, but the unit reports failure and the active vhost stays on disk.
- **Fix:** create the lock with `os.open(path, O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC, 0o600)`. Optionally refuse to proceed if `fstat` shows a uid other than 0 or any group/other permission bits.

**A-3. Low. Activation trusts the on-disk active vhost and location include without checking their hashes.**
- **Where:** `signing-activate.py:156` writes `ACTIVE.read_bytes()` unchecked.
- **Why it matters:**
  - The D3 header strip and the gate line both live in `/etc/nginx/cbob-signing-location.conf`, which the installer renders.
  - If that include came from an older template, or was hand-edited, activation would open a route without the gate or the header strip, and nothing would report it.
  - Only root can write these files, so this is defence in depth.
- **Fix:**
  - Compare the SHA-256 of `ACTIVE` with the `files` row in `signing-delivery-state.json`.
  - Have the installer record the rendered location include's hash in the same state file and have activation compare it, or at minimum require that the include contains the exact gate line, `open_file_cache off;` and `proxy_set_header Authorization "";`.

**I-1. Low-Medium. The installer briefly writes secrets with umask permissions.**
- **Where:** `install-signing-delivery.py:7-9`. `t.write_bytes(data)` creates the temp file as 0644, and `chmod` only runs afterwards.
- **Which files are exposed:**
  - `/etc/nginx/.cbob-signing-proxy-secret.conf.cbob-new`, in a 0755 directory, so readable by every local account.
  - The location include, which contains the unlisted outer path.
  - `/etc/cbob/.ceremony.env.cbob-new` and the state JSON, readable by the ubuntu group.
- **Consequence:** an inotify watcher can open the file in that window and keep the descriptor. With the proxy secret, a local process can reach 8790 directly without basic auth.
- **Fix:** set `os.umask(0o077)` at the top. Better, create the temp file with `os.open(t, O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW, mode)` and `fchown` it before writing. Add an `fsync` before `os.replace`.

**I-2. Low-Medium (integrity of the verification evidence). Both drafts enforce every safety check with `assert`, and they live in an ubuntu-writable directory.**
- **Where:** installer lines 4, 17-20, 22 and 34; harness lines 4, 7-8, 11, 26, 31-32, 51, 64 and 95.
- **Asserts disappear under optimisation:**
  - Under `python3 -O`, or with `PYTHONOPTIMIZE` set and no `-I`, every assert is stripped.
  - The installer would then skip its root check, artifact digest equality, refusal-state precondition and install-validation return codes.
  - The harness's `check()` would record every check as passed and write `result: passed`.
- **The directory is ubuntu-writable:**
  - Running `python3 /home/ubuntu/cbob-ecosystem-audit/verify-signing-delivery.py` as root, without `-I`, puts that directory first on `sys.path`.
  - Any concurrent session that writes as ubuntu can plant a module there (`json.py`, `ssl.py` and so on), or edit the script between review and execution.
- **Fix:**
  - Replace the asserts with explicit `raise`.
  - Commit both drafts into the repo.
  - Install or run them from the pinned commit object as a root-owned copy, always with `/usr/bin/python3 -I`.

**I-3. Low-Medium. The installer accepts any 40-hex commit and does not pin the reviewed bytes.**
- **Where:** `install-signing-delivery.py:4-6, 31-32`. It records SHA-256 values but compares them against nothing.
- **Why it matters:**
  - It does not check that the commit is pushed or reviewed, for example with `git merge-base --is-ancestor <review> origin/<branch>` after a fetch.
  - The files changed during this review, which shows that "the reviewed version" is not the same thing as "whatever the working tree held at install time".
- **Fix:** hardcode the triaged delivery commit, as the artifact commit and digest already are. Alternatively, hardcode the expected SHA-256 of each of the six installed files plus the location template, and refuse on any mismatch.
- **Smaller points:**
  - Running `git` as root against an ubuntu-owned repo hits the safe.directory check unless `SUDO_UID` matches the owner. Running the installer via `sudo` from the ubuntu account avoids this; a root login shell does not.
  - The installer cannot be re-run: line 22 refuses if the proxy secret already exists, so a failure after line 23 leaves partial state. Document the manual rollback, or make the run resumable against the state file.

**I-4. Low. The harness rewrites the runtime auth file outside the lock.**
- **Where:** `verify-signing-delivery.py:77` calls `activation.atomic` directly, without the delivery lock and without checking the marker.
- **Effect:** if a closure (the timer or a stop) runs at the same moment, the harness can recreate `/run/cbob-signing/auth.htpasswd` containing Gary's hash after the closure has deleted it. The marker is absent, so the route still refuses, but the file is left behind until the next closure or reboot.
- **Fix:** do the swap under `activation.delivery_lock(RUNTIME)`, and only while `open` exists.

**N-1. Informational.**
- **Path disclosure while closed (D8):** the location still returns 503 when closed, while other paths return 404. This was optional before and is unchanged.
- **Stapling warning in the refusal vhost:** `nginx-signing-refusal.conf` lacks `ssl_stapling off`, so it emits the harmless stapling warning while closed. This is documented.
  - Do not change it before installing. The installer's line 20 requires the live refusal vhost to match the commit's refusal template byte for byte. Change the template only together with a Stage 1 refusal reinstall.

## Missing verification

**V-1. The plan promises checks the harness does not perform.**
- The plan (lines 126–135 and 227–229) lists:
  - a startup-failure path, where `ExecStopPost` runs and both the marker and runtime auth are absent;
  - lock contention on the live system;
  - after every closure: the vhost SHA-256 equals the refusal template, the refuse unit shows `Result=success`, and `/run/cbob-signing/auth.htpasswd` is absent;
  - the old apex route returning 410;
  - the HTTP→HTTPS redirect, the ACME path, and the DNS record staying direct (DNS-only).
- `stopped()` only checks that the marker is gone, the outer path returns 404/503 and port 8790 is closed.
- The harness never records `StartLimitIntervalUSec` or `DefaultDependencies` for the refuse unit.
- `mainpid()` in the harness also omits the SubState check.

**V-2. Unit-test gaps** (cheap to add, all with injected runners):
- **`activate()` ordering:** the timer is armed and confirmed before any auth write; a timer that is not armed means no auth write.
- **Input refusals:** `owner_auth` with wrong metadata, a second line, no trailing newline, or a symlink; a malformed verification entry.
- **`open_window`:** the "already open" path.
- **`listener_pid`:** `SubState` other than `running`, and `MainPID=0`.
- **`refuse.main()` ordering:** the lock-contention test sequences `clear_runtime` and `acquire` by hand and never calls `main()`.

**V-3. The verification report omits the outer path,** which is correct. It is written with default permissions, so `/var/backups/cbob-signing` must be root 0700 before the run. Check that it exists first; otherwise the write in `finally` raises and hides the real failure.

## Required before Stage 2 step 5

1. Fix A-1 (normal activation refuses while a verification timer exists, and the harness runs `reset-failed`).
2. Fix I-1 and I-2, then pin per I-3 to the commit containing the post-edit bytes reviewed here.
3. Extend the harness per V-1.

A-2 and A-3 are recommended, not blocking.
