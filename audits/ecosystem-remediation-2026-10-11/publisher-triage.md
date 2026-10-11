# Triage of `publisher-remediation-review.md` against the current `/opt/cbob-vaults/web/deploy`

**Scope read in full:** `publish-ecosystem.sh`, `publish-files.py`, `restore-ecosystem.sh`, `go-live.sh`, `configure-rpc.py`, `check-live-rpc.mjs`, `legacy-publish-retired.sh` and `LEGACY-PUBLISHER.md`. For context I also read `rpc-proxy.mjs`, `nginx-rpc.conf`, `ecosystem.rpc-proxy.config.cjs`, `scripts/prepare-static-pages.mjs`, `scripts/update-web-hashes.mjs`, `web/build.mjs`, both `.gitignore` files, and the README pin table (`web/README.md:396-415`).

**Not done:** nothing was executed. I did not read the host state: crontab, live nginx, `/etc/cbob`, umask, or the pm2 dump.

## Verdict

Two blockers remain: **B1** and **B2**. **B3** should be fixed in the same change. Everything else is Low and does not block a first `--execute`, as long as the blockers are fixed.

---

## Blockers

### B1 (Medium): a failed `go-live.sh` can leave the relay saved in pm2's dump. The relay itself is also never checked as reviewed or pushed.
**Where:** `go-live.sh:9, 24-39`

**Failure path:**
- Line 9 checks only that `web bank scripts launch` are clean. It does not check that HEAD is pushed or reviewed.
- Lines 24-38 then install the nginx block and start `rpc-proxy.mjs` from the working tree. The proxy enforces the method allowlist and the transaction filter, so it is security-relevant code. Line 38 then runs `pm2 save`.
- Only line 39 (`publish-ecosystem.sh`) enforces the stricter conditions: whole repository clean (`publish-ecosystem.sh:11`), pushed (`:12`), and pins matching (`:14`).
- Example: one stray untracked file outside those four directories, or an unpushed commit, makes publish refuse **after** the relay is live and saved. The ERR trap then restores nginx and deletes the proxy, but never re-saves. The dump still lists `cbob-rpc-proxy`, so `pm2-ubuntu` brings it back on reboot, now running against the restored env.
- Partial failure: `publish-ecosystem.sh:34` (`install -d`) can fail after the files are live. The rollback then tears the relay down while the new pages, which call `/rpc`, stay published.

**Fix:**
- Add a `--check <commit>` mode to `publish-ecosystem.sh` that runs lines 6-19 and writes nothing. Call it in `go-live.sh` before `configure-rpc.py`.
- Move `pm2 save` to after the publish succeeds.
- Add `pm2 save` to `rollback()`, after the delete or restart.

### B2 (Medium): the published bytes are never checked against the hash pins or `BUILD.txt`.
**Where:** `publish-ecosystem.sh:14-28`

**Failure path:**
- `update-web-hashes.mjs` builds into the shared `web/dist`. It compares only `*/app.js` and `assets/style.css` against the README.
- Lines 25-28 copy from `web/dist` later. Nothing re-hashes what was staged.
- `publish.flock` serializes publish and restore only, not builds. A concurrent `node web/build.mjs` (tests, an operator) runs `rmSync(OUT)` and rebuilds (`build.mjs:102`). That can leave a partial or different tree, and it gets staged.
- `publish-files.py:47-48` then checks site bytes against the stage, which is self-consistent but unpinned.
- Separately, `index.html`, the vault images and `market-share.png` have no pin at all.
- Any gitignored file under `web/src/assets/` is copied by `build.mjs:119` and published. `git status` (line 11) never reports ignored files.

**Fix:**
- After staging, check every file under `stage/public/<section>` against its `web/dist/BUILD.txt` line. Refuse any staged dist file that is not listed.
- Check the staged `app.js` and `style.css` against the README pins.
- Refuse if `git status --ignored --porcelain -- web/src web/site` prints anything.
- Alternatively, build with `--out` straight into the stage.

### B3 (Medium): the "exact reviewed commit" check means nothing when called from `go-live.sh`, and any pushed branch qualifies.
**Where:** `go-live.sh:39`, `publish-ecosystem.sh:10, 12`, `update-web-hashes.mjs:24-27`

**What's wrong:**
- `go-live.sh` passes `"$(git rev-parse HEAD)"`, so the check at `publish-ecosystem.sh:10` always passes on that path.
- `@{upstream}` is the upstream of whatever branch is checked out. A pushed WIP branch passes.
- The pins are the real review binding. But `--accept-reviewed` accepts any file of at least 100 bytes, and the review's sha256 is only printed, never committed. So the pin table cannot be traced to a review. That matters here because `account` and `market` (the signing pages) are in the section list (`publish-ecosystem.sh:25`) and are pinned (`README:396, 403`).

**Fix (no new approval step needed):**
- `go-live.sh` should take `--execute <commit>` from the operator and pass it through unchanged.
- Check against the release branch by name (for example `origin/main`) instead of `@{upstream}`.
- Have `update-web-hashes.mjs` write the review artifact's path and sha256 into the README next to the pins, so the pin change and its review land in the same commit.

---

## Low (not blocking)

**Publishing (`publish-files.py`, `publish-ecosystem.sh`)**

- **L-a: published files take the stage's owner and mode.** (`publish-files.py:12-14`)
  - Every published file becomes `ubuntu:ubuntu` with the stage's mode, which depends on umask.
  - With a 027 or 077 umask, the `tar -x` and `cp -a` outputs are 640 or 600. nginx (www-data) then gets 403 on the whole site. The byte check (run as root) still passes.
  - Fix: keep the destination's owner and mode for existing files, and use an explicit 0644 (dirs 0755) for new ones.
- **L-b: restore leaves new directories behind, and publish never deletes.** (`publish-files.py:33`)
  - Restore removes new files but leaves the new directories (for example `/account/`, `/market/`).
  - Publish never removes files the reviewed tree dropped, so a page deleted for a security reason stays live.
  - Fix: document this, or add an explicit delete list to the manifest.
- **L-c: brief window where a page will not run.** Files are replaced one at a time in sorted order, so `app.js` lands before `index.html` and the old SRI meets the new bytes. `?v=` does not help, because the origin serves only one `app.js`.
  - Original L3 is still open: there is no check through the origin and no Cloudflare purge.
  - This fails closed (the script refuses to run), so it affects availability only.
- **L-d: the pin check can pass with no pins.** If the README table is ever removed or reformatted, the regex matches nothing and `update-web-hashes.mjs:19` reports a match. Fix: require the parsed row set to equal the freshly built set.
- **L-e: no guard against collisions when merging trees.** If the built `assets/` and `web/site/assets/` ever share a file name, the build silently wins (`publish-ecosystem.sh:24-28`), and the SRI in the static pages breaks. There is no collision today; I checked both trees.
- **L-f: predictable log path.** `/tmp/cbob-publish-pins.log` has a fixed name. `protected_symlinks` mitigates this. Use `.cache/` or `mktemp` instead.

**Relay configuration (`configure-rpc.py`)**

- **L-g: the TLS check can be satisfied by a comment.** (`configure-rpc.py:9`) The `listen ...443` regex is not anchored to the start of a line, so `# listen 443 ssl;` satisfies it on a port-80 server. Fix: strip comments and match `^\s*listen\b`.
- **L-h: the real-IP check is too loose.** (`configure-rpc.py:50`)
  - The directives can match anywhere in `nginx -T`, including another site's server block, not just the http context.
  - The `set_real_ip_from` ranges are not checked, so `0.0.0.0/0` would pass and let clients that bypass Cloudflare spoof their rate-limit key.
  - Fix: check the http context and the Cloudflare ranges.
- **L-i: the `/rpc` block has no end marker.** (`configure-rpc.py:35-37`) The brace count stops added blocks, but brace-free directives appended after the closing `}` would still be inserted at server level. Fix: cut at the matching brace and require only whitespace after it.
- **L-j: env file mode and the DAS upstream are not checked.**
  - The env file's mode is enforced only when the file is rewritten (`:60`). A file that already holds the collection keeps whatever mode it has, possibly world-readable. Fix: assert `st_mode & 0o077 == 0`.
  - `CBOB_DAS_UPSTREAM` is never checked. `rpc-proxy.mjs:235` accepts `http://`, which sends the API key in cleartext. No probe checks that the DAS upstream is on mainnet.
- **L-k: `nginx -t` output is still thrown away.** (`configure-rpc.py:61`, original L4) Print it to stderr; it contains no secrets.
- **L-l: RPC backups pile up.** Every backup under `/var/backups/cbob-rpc/config-*` keeps a copy of the upstream API key with no retention limit. After a key rotation, the old keys remain on disk.

**Release checks (`check-live-rpc.mjs`)**

- **L-m: probes still missing.**
  - An unsigned System transfer sent with `sendTransaction` is refused. This was in the original M8, and it proves the transaction filter is active.
  - A positive `getAssetsByGroup` for the real collection.
  - The collection's data byte 0 is 5 and its update authority is `MINT_AUTH`. Today only the owner program is checked (`:15`).

**`go-live.sh` rollback**

- **L-n: rollback rough edges.**
  - **`pm2 pid` regex:** the test in `rollback()` is not anchored (line 27), so text like a "PM2" banner matches. Use `^[1-9][0-9]*$`.
  - **Stopped proxy:** a proxy that existed but was stopped prints `0`, and the rollback then deletes it.
  - **Restart is not a revert:** `pm2 restart` runs the new `rpc-proxy.mjs`, not the old code.
  - **No retry after reload:** the public probe runs right after `systemctl reload`. A transient failure causes a rollback, which is safe but flaky.
  - **Port conflict:** if a stale listener (for example under a root pm2 daemon) already holds 8789, the direct probe hits it and passes. Fix: check the 8789 listener's pid against `pm2 pid`.

**Retired publisher**

- **L-o: still no logging.** `legacy-publish-retired.sh` does not log its caller (original L2). `LEGACY-PUBLISHER.md` now documents the install and reversal procedure, but the yearly cron caller (pending D9) will fail silently. Add `logger -t cbob-retired-publisher`.

---

## Status of the original findings

| ID | Status | Notes |
|---|---|---|
| H1 | Partial | Commit argument, pushed check and pins are in place, but see B3 |
| H2 | Fixed | Manifest, unique backup, flock, restore, byte check. Residuals: L-a, L-b |
| M1 | Fixed | |
| M2 | Mostly fixed | Ignored files under `web/src/assets` remain (B2). esbuild version is not recorded; the pins cover it for `app.js` and `style.css` only |
| M3 | Fixed | |
| M4 | Mostly fixed | B1 remains |
| M5 | Fixed | |
| M6 | Partial | L-g, L-h |
| M7 | Mostly fixed | L-j |
| M8 | Mostly fixed | L-m |
| L1 | Fixed | |
| L2 | Partial | L-o |
| L3 | Open | L-c |
| L4 | Partial | L-i, L-k |

## Still unchecked on the host

- The ubuntu user's umask (L-a).
- Where `real_ip_header` and `set_real_ip_from` actually sit in the nginx config (L-h).
- The current mode of `/etc/cbob/rpc-proxy.env` (L-j).
- Whether `@solana/web3.js` resolves when the working directory is `/opt/cbob-vaults` (`go-live.sh:12-20`; it fails closed if not).
- Whether `pm2-ubuntu` is running (L-n).
