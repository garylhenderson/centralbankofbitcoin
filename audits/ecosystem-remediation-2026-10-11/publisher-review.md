# Audit: CBOB deployment safety scripts (scope: `web/deploy/*`)

**What I read:** `publish-ecosystem.sh`, `go-live.sh`, `configure-rpc.py`, `check-live-rpc.mjs` and `legacy-publish-retired.sh`, all in full. For context I also read `nginx-rpc.conf`, `ecosystem.rpc-proxy.config.cjs` and `rpc-proxy.mjs`, plus the parts of `build.mjs`, `config.js`, `check-launch-params.mjs`, `launch/mainnet-init.json` and `cbob-public-data.service` that these scripts depend on.

**Not run:** nothing. I could not see the crontab, the live nginx config or the `/etc/cbob` env file, so every finding below that depends on host state is marked as conditional.

---

## HIGH

### H1. `publish-ecosystem.sh` ships the new signing pages with no machine-checked review gate
`publish-ecosystem.sh:5-6, 21`
- **What happens:** The only gates are "pass `--execute`" and "the working tree is clean." Line 21 publishes `account` and `market`, which are the new signing pages. Those pages "may not ship until this review and independent triage pass."
- **Why it matters now:** This script, unlike `go-live.sh` (see M3), can actually run under D5(b). Any local commit passes it, reviewed or not. A single `bash web/deploy/publish-ecosystem.sh --execute` makes the signing pages live.
- **Fix:**
  - Require an approved commit. Either take it as a required argument, or keep a committed `launch/publish-approved` file that only the triage step writes. Refuse unless `git rev-parse HEAD` matches it exactly and `git merge-base --is-ancestor HEAD origin/<branch>` succeeds.
  - Until triage passes, take `account` and `market` out of the line-21 section list. Publishing them should be a separate opt-in, for example `--sections`.

### H2. Rollback cannot undo a publish
`publish-ecosystem.sh:12-22`
- **(a) New files are never removed.** The backup only copies files that already existed (lines 14-19). Anything a publish creates is not recorded anywhere. If `/account/` or `/market/` did not exist before, restoring the backup leaves them live. A premature signing-page publish therefore cannot be rolled back with the backup.
- **(b) The backup misses files.** `rg --files web/site` (line 20) skips hidden and gitignored files, but `rsync -a web/site/` on line 22 copies them. Anything those files overwrite at the web root has no backup.
- **(c) The backup can be overwritten.** The backup directory is named to one-second resolution and created with `mkdir -p`. Two runs in the same second (two operators, or a retry loop) share one directory. The second run then backs up the first run's freshly published files, and the real rollback point is lost.
- **(d) No restore tool or lock.** There is no restore script, and no lock against a second publish running at the same time.
- **Fix:**
  - Before writing, record a manifest of every destination path the rsyncs will touch, marked as existed or new. Building it from `rsync -a --dry-run --itemize-changes` is one way.
  - Create the backup directory with `mktemp -d`, or fail if it already exists.
  - Hold an exclusive lock (`flock /var/lock/cbob-publish`) for the whole run.
  - Commit `restore-ecosystem.sh <backup>`, which restores the old files and deletes the new ones listed in the manifest.

---

## MEDIUM

### M1. Integrity checks pass when they fail to run
`publish-ecosystem.sh:10, 20`
- **Line 10:** `if rg -q 'uncommitted' "$profile/BUILD.txt"` counts any non-zero exit as "clean." That includes exit 2 (BUILD.txt missing or unreadable) and exit 127 (`rg` not on PATH). `set -e` does not apply inside an `if` condition, so the dirty-build check passes when it cannot run.
- **Line 20:** if `rg --files` fails inside `< <(...)`, the loop reads nothing and `set -e` never fires. No site-file backups are taken, and line 22 then overwrites `/index.html` and the statement pages with no backup.
- **Also:** `BUILD.txt` reports `commit unknown` when git fails (`build.mjs:129-131`), and that is not refused.
- **Fix:**
  - Require `BUILD.txt` to exist.
  - Use `grep -q` and check its exit code explicitly (0 = refuse, 1 = ok, anything else = abort).
  - Require the line to match `^commit    [0-9a-f]{40}$`, with no "uncommitted" text, and equal to `HEAD`.
  - Build the site file list with `git ls-files -z web/site` into an array and check its exit status.

### M2. Files git ignores are published, and some build inputs are never checked
`publish-ecosystem.sh:6, 22`
- **Ignored files:** `git status --porcelain --untracked-files=all` does not list ignored files. An ignored file inside `web/site/`, such as a stray `.env`, notes, a backup or editor junk, is copied to the public web root by `rsync -a web/site/`.
- **Unchecked inputs:** the clean-tree check covers `web bank scripts launch` only. It misses `package.json`, the lockfile, `node_modules`, the release `dist/` that `build.mjs` checks program hashes against, and the esbuild that `build.mjs:31` loads from `/home/ubuntu/luna-remotion/node_modules`, which belongs to an unrelated project with an unpinned version.
- **Fix:**
  - Publish `web/site` from `git archive HEAD web/site` or `git ls-files`, not from the working tree, or refuse if `git status --ignored --porcelain -- web/site` reports anything.
  - Extend the clean-tree check to the whole repository.
  - Record and assert the esbuild version in `BUILD.txt`.

### M3. `go-live.sh` cannot run under D5(b), and cannot be re-run after launch
`go-live.sh:10, 15-16`
- **It refuses now:** `check-launch-params.mjs` refuses while any value is OPEN (line 53). It refuses specifically while `charter_opens_at`, `lock_deadline` (lines 87-89, 341) and `vault_collection` (line 344) are OPEN. `launch/mainnet-init.json:38` and `config.js:78` both still have the collection as `null`.
- **The collection needs an on-chain write:** it is "created at road step 10", which D5(b) forbids. So the script always stops at line 10 or line 16. Stopping is the safe outcome, but it means no committed path to enable the relay exists today.
- **It will refuse again after launch:** `check-launch-params.mjs:148` requires the charter to open in the future. Once that date passes, `go-live.sh` can never be re-run, for example to recover the relay after an incident.
- **The real risk:** an operator under pressure runs `configure-rpc.py`, `pm2` and the nginx reload by hand, skipping every check.
- **Fix:** Make relay enablement depend only on what the relay needs: a committed collection that matches `PROFILES.mainnet`, an upstream on mainnet (see M8), and a clean tree. Keep `check-launch-params` for the money switches. State in the script that the relay cannot exist before the collection does, because `rpc-proxy.mjs:236` refuses to start without one.

### M4. `go-live.sh`: wrong step order, and nothing is undone on failure
`go-live.sh:20-26`
- **Pages before relay:** line 20 publishes the pages before the relay is configured or verified.
- **`pm2 save` too early:** line 23 saves the process list before any check. A failed go-live leaves the proxy registered in the dump, so it comes back after a reboot.
- **Crash loops look like success:** `pm2 startOrRestart` exits 0 even when the app immediately crash-loops, for example on an unreadable env file or a missing `CBOB_RPC_UPSTREAM`. The script then reloads nginx (line 25), which puts `/rpc` live in front of a dead or misconfigured upstream, before the first check runs.
- **No cleanup:** if `check-live-rpc.mjs` fails, nothing is undone. nginx has already been reloaded and the proxy keeps running.
- **Pending config:** if a step between `configure-rpc` and the reload fails, the `/rpc` block stays on disk unreloaded. The next unrelated `nginx reload` (another deploy, a certbot hook) silently makes it live.
- **Fix:**
  - New order: configure, start, then probe the proxy directly on 127.0.0.1:8789 (POST with Origin set, `getGenesisHash`).
  - Assert `pm2 jlist` shows the app online with no new restarts after about 15 seconds.
  - Then run `nginx -t`, reload, and the public check. Run `pm2 save` last.
  - On any failure, install a trap that runs `pm2 delete cbob-rpc-proxy`, restores the `configure-rpc` backup, and reloads nginx.
  - Publish the pages only after the relay is verified, or as a separate step.

### M5. Nothing stops `go-live.sh` running as root, which triggers a known incident
`go-live.sh:22-23`
- **What happens:** the script uses per-command `sudo`, so it is meant to run as ubuntu, but nothing enforces that.
- **Under `sudo bash go-live.sh --execute`:**
  - `pm2` spawns a root daemon in `/root/.pm2`. This is the same failure as the 2026-04-26 deploy incident.
  - The proxy runs as root.
  - `pm2 save` writes root's dump, so `pm2-ubuntu` does not restore the proxy after a reboot.
  - `public-data.mjs` (`publish-ecosystem.sh:24`) also runs as root.
- **Fix:** Add `[ "$EUID" -ne 0 ] || { echo 'run as ubuntu' >&2; exit 1; }` to `go-live.sh` and `publish-ecosystem.sh`, or call `sudo -u ubuntu pm2 …` explicitly.

### M6. `configure-rpc.py` assumes, without checking, the setup the rate limits depend on
- **(a) Cloudflare real-IP is not verified.** `nginx-rpc.conf:10-15` says the per-IP limits only work if `real_ip_header CF-Connecting-IP` and Cloudflare's `set_real_ip_from` ranges are set in the http context. `configure-rpc.py` never checks this.
  - Without it, `$binary_remote_addr` and `X-Real-IP` are Cloudflare edge addresses.
  - The proxy's `sendTransaction` bucket (1/s, burst 5; `rpc-proxy.mjs:59`) is then shared by every visitor behind one edge, so one script can block a whole region's transactions.
  - **Fix:** after the `nginx -t`, run `nginx -T` and refuse unless `real_ip_header CF-Connecting-IP;` and at least one `set_real_ip_from` are present in the http context.
- **(b) The block may land in the wrong server.** `configure-rpc.py:6-7` requires exactly one `    server_name centralbankofbitcoin.com;` line, but does not check that this server listens on 443. If the TLS server lists `www.` as well and the only exact match is the port-80 server, the relay is installed on plain HTTP.
  - **Fix:** find the enclosing `server {}` and require a `listen 443` line inside it.

### M7. `configure-rpc.py` writes non-atomically and does not check the env file
`configure-rpc.py:24-26, 35-36, 40`
- **Non-atomic writes:** `write_text` truncates and then writes, both for the live nginx site file and for the secrets env file. The env file is rewritten even when nothing changed. A crash, a full disk or a kill partway through leaves a truncated nginx file (nginx then fails to start on reboot) or an empty env (the proxy fails on its next restart). The rollback (line 40) uses the same non-atomic `copy2`.
- **Owner not checked:** `os.chmod(env, 0o600)` without checking the owner. The PM2 proxy runs as ubuntu with `--env-file` (`ecosystem.rpc-proxy.config.cjs:13`). A root-owned file at mode 600 cannot be read, so the proxy crash-loops, which M4 does not catch.
- **Required keys not checked:** `CBOB_RPC_UPSTREAM` (must be https), `CBOB_RPC_ORIGIN` (must equal `https://centralbankofbitcoin.com`) and `CBOB_RPC_PORT` (must be 8789, matching nginx) are never validated. Values can be checked without being printed.
- **Fix:**
  - Write to a temp file in the same directory, `fsync`, copy the original uid, gid and mode, then `os.replace`.
  - Skip the env write when its content is unchanged.
  - Assert `st_uid == pwd.getpwnam('ubuntu').pw_uid`.
  - Validate the required keys by name and shape only.

### M8. `check-live-rpc.mjs` passes a refusal that came from the wrong layer, and misses key cases
- **(a) Status codes only.** Every refusal probe checks only for 403. A Cloudflare WAF or bot challenge, or an nginx 403, makes the "Missing Origin refused" and "requestAirdrop refused" probes pass without the proxy's rules ever running.
  - **Fix:** parse the body and assert the proxy's JSON-RPC error: `error.code === -32600` with message `not this site`, and `-32601` with `method requestAirdrop is not served here`.
- **(b) Missing probes:**
  - `getGenesisHash` equals mainnet `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. As written, a devnet upstream passes `getSlot`.
  - A wrong Origin (`https://evil.example`) is refused. The cross-site case, the one that matters for CSRF, is never tested; only a missing Origin is.
  - `Sec-Fetch-Site: cross-site` with the correct Origin is refused.
  - `OPTIONS` is refused.
  - No `Access-Control-Allow-Origin` header appears on any response.
  - `getAssetsByGroup` with a different `groupValue` is refused. This proves `CBOB_VAULT_COLLECTION` was loaded.
  - An unsigned plain System transfer sent with `sendTransaction` is refused. It is rejected before anything is forwarded, so nothing reaches the chain.
  - `getAccountInfo(collection)` returns an account owned by `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`. `go-live.sh:16` only checks that the collection address has the right format.

---

## LOW

### L1. The last step of the publish can fail it after the pages are already live
`publish-ecosystem.sh:24-25`
- **Problem:** the publish ends by running the public-data job (`bank/public-data.mjs`) under `flock -n`. If the systemd timer holds the lock, or the job hits one read failure (`public-data.mjs:10-11` sets `exitCode = 1`), the script exits non-zero after the pages are live. It never prints the backup path, and `go-live.sh` stops before configuring the relay.
- **Fix:** print the backup path right after creating it. Use `flock -w 600`, and report a refresh failure as a warning rather than a publish failure.

### L2. `legacy-publish-retired.sh` has no committed install or reversal procedure
- **Not reversible as committed:** nothing records which entrypoint it replaces, a backup of the original with its sha256, owner and mode, or how to revert. "Reversible" is not true of what is committed.
- **No logging:** it only writes to stderr. While the cron line still exists, each run either mails or alerts, or is silently discarded, so you cannot tell which callers are left.
  - **Fix:** add `logger -t cbob-retired-publisher "caller=$(ps -o args= $PPID)"`.
- **Chained jobs (conditional):** if a cron line chains the old entrypoint, as in `old && next`, the stub's exit 1 silently stops every later step. Inspect those chains.
- **Old path under `/tmp` (conditional):** `go-live.sh:2` says the old script lived in `/tmp`. If a cron still points at a `/tmp` path:
  - the stub is deleted when `/tmp` is cleaned at boot;
  - after that, any local user can create a file at that path in the world-writable directory;
  - if the cron runs as root, that is local privilege escalation.
  - A `/tmp` target must have its cron line removed or repointed to a root-owned path outside `/tmp`. Stubbing it is not enough.

### L3. No check that the site actually serves what was published
`publish-ecosystem.sh`
- **What's missing:** nothing confirms the served files match `BUILD.txt` after the publish.
- **Cache risk:** `app.js` is cache-busted by `?v=` (`build.mjs:137`), but the origin has only one `app.js` per page, and the rsync replaces HTML and JS non-atomically. Any HTML cached by Cloudflare or a browser loads new bytes against old SRI values, and the page refuses to run. No Cloudflare purge is done.
- **Fix:** fetch each published `index.html` and `app.js` through the origin and compare their sha256 to `BUILD.txt`. Purge or bypass the cache for those paths.

### L4. Smaller problems in `configure-rpc.py`
- **Diagnostics discarded:** lines 37 and 42 throw away the `nginx -t` output (`from None`). It contains no secrets, so print it to stderr.
- **Duplicate env key:** line 24's regex misses `export CBOB_VAULT_COLLECTION=` and lines with leading whitespace. It would then append a duplicate key, and the later one wins.
- **Unbounded block:** line 19 pastes everything after `location = /rpc {` into the server block. Anything appended to `nginx-rpc.conf` later would be installed silently. End the block at its matching brace.

---

## Not verifiable from the files (check before running)
1. Whether `@solana/web3.js` resolves from `/opt/cbob-vaults` as cwd, for the `go-live.sh:11` heredoc and for `rpc-proxy.mjs`. Glob found no `node_modules/@solana/web3.js` under `/opt/cbob-vaults` (it may not follow symlinks). If it does not resolve, the heredoc fails safely, but the PM2 proxy crash-loops and only M4's missing liveness check would catch it.
2. Whether `rg` is on PATH for the user who will run `publish-ecosystem.sh` (M1).
3. The actual crontab entries that call the old publisher, and the user they run as (L2).
4. The live nginx http context: whether it has the Cloudflare real-IP include, and whether a `cbob_rpc` zone is already defined somewhere else (M6).
5. The owner of `/etc/cbob/rpc-proxy.env` (M7).
