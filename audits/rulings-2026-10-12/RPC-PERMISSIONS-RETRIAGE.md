I've read the three files in scope. I'm reporting what remains below.

# Delta re-triage: configure-rpc.py, configure-rpc.test.py, go-live.sh

**Scope note:** `rpc-permissions-review.md` does not exist under `/opt/cbob-vaults` or anywhere under `/opt`. I triaged against the L1–L5 summary in the brief. I opened two neighbouring files for context only and did not audit them: `ecosystem.rpc-proxy.config.cjs`, to see how the env file is consumed, and `nginx-rpc.conf`, to see the block shape. I did not run the tests, so the "nine pass under sudo" claim is the author's, not mine.

## L1–L5 status (confirmed by reading the code)

| Item | Where | Verdict |
|---|---|---|
| Checked parent | `configure-rpc.py:7-10`, called at `:18`, `:51`, `:56`, `:61` | Fixed. `lstat`, so a symlinked parent is refused. Only the immediate parent is checked, which is fine for `/etc/cbob`. |
| Descriptor-validated layout | `:19-25` (`O_NOFOLLOW`/`O_NONBLOCK`, then `fstat`) | Fixed. FIFO, symlink, hardlink and bad modes are all refused, and tests cover each. |
| Regular, single-link target | `:39-40` (atomic), `:88` (backup) | Fixed. |
| Explicit ownership on restore | `:55-57`; ENV layout re-validated at `:56` | Fixed. Tested at `test.py:80-88`. |
| Legacy warning | `:26` (stderr, so it can't pollute `$configuration`) | Fixed. |
| Sanitized decoding and errors | `:28`, `:103` | Fixed for the env read path. |
| Root-required tests / `-I` | `test.py:92`; `go-live.sh:28,30` | Fixed. `-I` keeps the script directory and cwd off `sys.path`. |

## Remaining issues

### M1 (Medium): go-live runs working-tree files as root without pinning them to the reviewed commit
- **Where:** `go-live.sh:9-14` vs `:25-28`; `configure-rpc.py:4,67`.
- **Failure path:**
  1. The clean-tree check and the HEAD check (`:9`, `:12`) run before the lock is taken (`:25-26`).
  2. Several seconds pass, including the `publish-ecosystem.sh --check` and node steps.
  3. `sudo python3 -I web/deploy/configure-rpc.py` then runs as root. It reads `nginx-rpc.conf` from the live tree via `ROOT/'web/deploy/nginx-rpc.conf'`.
  4. If anything edits `/opt/cbob-vaults` in that window, unreviewed content becomes the root-installed nginx config. The same goes for the configure script itself, `check-live-rpc.mjs` and `rpc-proxy.mjs`. Other sessions edit this box, so this is a real possibility.
  5. `-I` does not help here, because it protects `sys.path`, not the script file.
- **Fix:**
  - Take the `flock` first.
  - Re-run `git status --porcelain` and `[ "$(git rev-parse HEAD)" = "$head" ]` immediately before the `sudo` call, and again before `pm2 startOrRestart`.
  - Better: have root run `git -C /opt/cbob-vaults show "$head":web/deploy/configure-rpc.py` (and the `nginx-rpc.conf` blob) into a root-owned temp directory and execute that.

### L1 (Low–Medium): rollback is not best-effort and does not cover everything
- **Where:** `go-live.sh:29-35`.
- **Failure paths:**
  - **The handler can abort halfway.** `set -e` is still in force inside the trap handler. If `configure-rpc.py --restore` fails at `:30` (for example a partial restore after an `atomic` refusal), the handler exits before the pm2 restart, `pm2 save` and nginx reload, and the operator only sees a bash error.
  - **Publishing is not undone.** If `publish-ecosystem.sh --execute` (`:43`) fails after a partial publish, rollback restores the nginx and relay config. Pages may already be published that depend on `/rpc`.
  - **New code stays live.** `pm2 restart` re-reads `--env-file`, so the env rollback does take effect. But it restarts the new working-tree `rpc-proxy.mjs`, not the code that was running before.
  - **A late `pm2 save` failure rolls back a good release.** If `pm2 save` at `:44` fails, everything is rolled back even though publishing succeeded.
- **Fix:**
  - Start the handler with `set +e`, run each step independently and report each step's own failure.
  - Clear the trap before the step that cannot be undone, or record what publishing changed.
  - State plainly in the failure message that publishing and code are not rolled back.

### L2 (Low): the real-IP check is not scoped
- **Where:** `configure-rpc.py:81-82`.
- **Failure path:**
  - The regex runs over the whole `nginx -T` output. Any `real_ip_header CF-Connecting-IP;` in another `server {}` or `location` block, plus any single `set_real_ip_from`, satisfies it.
  - If the canonical server doesn't actually inherit it, `$binary_remote_addr` keys on Cloudflare edge addresses. As `nginx-rpc.conf:10-15` itself warns, one client can then starve a whole region.
- **Fix:**
  - Require the directive in the http context: check that the included `conf.d` file contains it and is included at http level.
  - Or test it at runtime in `check-live-rpc.mjs`, for example by asserting that `X-Real-IP` seen through nginx is not a Cloudflare range.

### L3 (Low): backup and restore are not byte-exact, and restore can stop halfway
- **Where:** `:44`, `:57`, `:70`, `:96` (text mode, locale encoding, universal newlines); the `:90` copy is byte-exact but the `:57` read is not.
- **Failure paths:**
  - **Not byte-exact.** CRLF in nginx config or the env file is silently rewritten as LF, so the original file is not truly restored.
  - **Partial restore.** A non-UTF-8 byte in a backed-up file raises `UnicodeDecodeError` in the middle of the `restore()` loop. Earlier files are then restored and later ones are not.
  - **Locale-dependent decoding.** The env decode at `:20` uses the locale encoding. Under a Latin-1 locale it never raises, so the "valid UTF-8" guarantee depends on the locale.
- **Fix:** handle bytes end to end (`read_bytes`, write in binary). Decode the env only for validation, with explicit `encoding='utf-8'`.

### L4 (Low): stale secret copies and no allowlist on restore paths
- **Where:** `:83-91`, `:52-58`.
- **Issues:**
  - **Old API keys accumulate.** Every run copies `/etc/cbob/rpc-proxy.env` (which holds the upstream API key) into a new `/var/backups/cbob-rpc/config-*`, and nothing ever deletes them. After a key rotation, the old keys stay on disk indefinitely.
  - **Manifest paths are not allowlisted.** `restore()` writes or unlinks whatever paths the manifest lists. The directory is root-owned and 0700, so this is defence in depth only.
- **Fix:**
  - Add retention: keep the last N backups, or delete the backup after go-live succeeds.
  - Allowlist manifest paths to `{resolved ng, zone, ENV}`.

### L5 (Low): the env parser can disagree with Node's `--env-file`
- **Where:** `:72-78`. The env file is consumed via `node_args: '--env-file=…'`.
- **Failure path:** Node supports multi-line double-quoted values. With `CBOB_DAS_UPSTREAM="` followed by a non-HTTPS URL on the next line:
  1. The validator sees an empty value and skips the HTTPS check.
  2. Node loads the non-HTTPS URL.

  Inline `#` comments diverge too, though that direction fails safe. The file is operator-written, so the impact is limited.
- **Fix:** refuse any CBOB_ line whose quotes don't close on the same line, and refuse unrecognised CBOB_ keys.

### L6 (Low): rollback deletes a stopped process
- **Where:** `go-live.sh:27,31`.
- **Failure path:** `pm2 pid` returns `0` for a stopped app. Rollback then runs `pm2 delete` and `pm2 save`, which removes a definition that existed before go-live started.
- **Fix:** before go-live, record whether the app existed (`pm2 describe`) separately from whether it was running.

## Missing verification
- **No test covers `main()`.** That leaves these untested:
  - `candidate()` insertion and refusal
  - idempotent re-run
  - collection mismatch
  - duplicate keys
  - restore after `nginx -t` fails
  - the stdout contract (the backup path is the only stdout line)
- **`main()` doesn't use the `ENV` constant that tests patch.** It hard-codes `env` at `:66`, a separate copy of the constant, so patching `rpc.ENV` wouldn't redirect `main()`. Use `ENV` there.
- **`go-live.sh` has no rehearsal of its rollback path.** No test or dry run covers a failure at `:39`, `:42` or `:43`.
- **Concurrency is only partly guarded.** Running `configure-rpc.py` directly has no lock. Only go-live's ubuntu-owned flock serialises runs.

## Commit readiness
- **`configure-rpc.py` and `configure-rpc.test.py`:** ready to commit. L1–L5 are addressed in the code as described. L2–L5 above are hardening, not blockers.
- **`go-live.sh`:** it can be committed, but it should not be executed until M1 is fixed (lock first, re-verify the tree and HEAD right before the root step, ideally run from the committed blob). Fix L1 (a best-effort rollback handler) in the same change.
