# Audit report: B9 fix (`web/deploy/configure-rpc.py`, `web/deploy/configure-rpc.test.py`)

**What I read:** both files in full. For context I also read `check-ceremony-env.py`, `install-signing-delivery.py`, `go-live.sh`, `cbob-ceremony@.service` and the B7–B10 section of `SIGNING-DELIVERY-REVIEW.md`. I grepped for every use of `rpc-proxy.env` and `CBOB_VAULT_COLLECTION`. I did not read any env, htpasswd or secret content, and did not run the tests or anything else.

**Verdict:** B9 is fixed. Root:ubuntu 0640 is accepted at `configure-rpc.py:13`, and the plain write at `:74` keeps the file's owner and mode through `atomic()` at `:29`. I found no blocker. It can be committed as post-signing configuration preparation. L1, L2 and L4 are small and should be fixed before the script is run for real.

## Findings

**L1 (Low–Medium): the write path does not re-check what the read path checked.**
- **Where:** `configure-rpc.py:29, 67-68, 74`.
- **What happens:**
  - `read_relay_environment` checks the open file descriptor (fd).
  - Everything after that uses the path again: `p.exists()`, `p.read_text()`, `p.stat()`, `shutil.copy2`, and `atomic()`'s `path.stat()`. All of these follow symlinks.
  - Nothing checks `/etc/cbob` itself. Today only `check-ceremony-env.py:6` does that, at ceremony start, not at configure time.
- **How it fails:** someone who can write to `/etc/cbob` swaps `rpc-proxy.env` for a symlink after the read check.
  - `atomic()` then copies the target's owner and mode, for example 0644.
  - `os.replace` puts the relay secrets into a regular file with those permissions.
  - The same swap lets the backup copy the wrong file.
- **Fix:**
  - At the start of `main`, check that `/etc/cbob` is not a symlink, is root-owned, and has no 0o022 bits, the same check as `check-ceremony-env.py:6`.
  - Have `read_relay_environment` return the validated `(uid, gid, mode)` and pass it to `atomic()` for the env file.
  - Inside `atomic()`, use `os.lstat` and refuse anything that is not a regular file.

**L2 (Low–Medium): restore does not keep ownership.**
- **Where:** `configure-rpc.py:29-30, 38, 67`.
- **What happens:**
  - The manifest records only `mode`.
  - `restore()` takes the owner from whatever file is at the path at restore time.
  - If the file is missing, it falls through to `mkstemp`'s root:root.
- **How it fails:**
  1. The env file is removed or recreated between configure and `--restore`. The second command is the `go-live.sh:30` rollback.
  2. Restore writes it back as root:root 0640.
  3. The rollback's `pm2 restart cbob-rpc-proxy` runs as ubuntu, so `--env-file` can no longer read it.
  4. In the other case, a foreign owner on the current file is kept, and the secrets are written into it.
- **Fix:**
  - Record `uid` and `gid` in the manifest.
  - In restore, `chown` and `chmod` explicitly.
  - For the env file, refuse unless the recorded layout is one of the two allowed ones.

**L3 (Low): the legacy layout is accepted without a word.**
- **Where:** `configure-rpc.py:13`.
- **What happens:**
  - An ubuntu:ubuntu 0600 file is writable by ubuntu.
  - `check-ceremony-env.py:9` refuses it (it requires uid 0).
  - `configure-rpc` keeps that layout, so the mismatch is pushed to the next unit start.
- **Fix:** print a metadata-only warning to stderr when the legacy layout is found, or require an explicit `--legacy-layout` flag.

**L4 (Low): one byte of secret content can leak through an error message.**
- **Where:** `configure-rpc.py:16, 81`.
- **What happens:** `UnicodeDecodeError` is a subclass of `ValueError`, so `:81` prints `str(e)`. That message includes the bad byte's value and its position in the env file.
- **Fix:** catch `UnicodeDecodeError` inside `read_relay_environment` and raise a generic `ValueError('Relay environment is not valid UTF-8')`.

**L5 (Low): the root-only tests can pass vacuously.**
- **Where:** `configure-rpc.test.py:14`.
- **What happens:** run without root, all five tests are skipped and the result reads `OK (skipped=5)`.
- **Fix:** make the run fail when not root, for example `sys.exit` unless `geteuid()==0`, or have the caller assert zero skips.

**L6 (Info): the expected env key set changes after configure.**
- **Where:** `install-signing-delivery.py:51`, and the B10 re-run checklist.
- **What happens:** both expect exactly three keys. After `configure-rpc`, the file has four (it adds `CBOB_VAULT_COLLECTION`).
- **Why this is not a bug in the fix:** `launch-ceremony.mjs:8` allows that key, and `ceremony-local.mjs:147` will then limit the ceremony's DAS queries to the collection, which is presumably intended. Any reused key audit must expect four keys.

## Test gaps

- The `restore()` function is never called. The test named "restore" at `:31` calls `atomic(..., 0o640)` directly. `restore()` hard-codes `/var/backups/cbob-rpc`, and the manifest round-trip is not covered.
- The plain write at `:29` is checked only indirectly, because the read at `:30` succeeds. No test checks `(uid, gid, mode)` straight after the default-mode `atomic()` call that `main` uses at `:74`.
- Missing cases:
  - `atomic()` on a path that does not exist yet, which gives root:root 0644;
  - a symlinked parent directory (`O_NOFOLLOW` protects only the last path component);
  - a hardlink;
  - extra mode bits such as 0o2640, which the read refuses but `atomic()` would strip.
- I did not run the tests, so I cannot confirm the claim that all five pass.

## Outside the assigned scope, one line

`go-live.sh:28,30` runs `sudo python3` without `-I` from the ubuntu-writable repo. A planted module in `web/deploy`, such as a `json.pyc` hidden by a gitignore rule, would load as root and slip past the clean-tree check at `:9`. Use `sudo /usr/bin/python3 -I`.

## Not affected by this change

No frozen program or signing artifact is touched. `install-signing-delivery.py`'s `EXPECTED` list does not include `configure-rpc.py`, and the actual collection does not exist yet.
