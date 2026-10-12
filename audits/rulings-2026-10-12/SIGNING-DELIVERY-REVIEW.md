# Audit: CBOB private signing-host delivery plan (`/opt/cbob-vaults` HEAD c085b15)

Scope: `launch/SIGNING-DELIVERY-2026-10-12.md`, `launch/ceremony-owner-verification.json`, `web/deploy/nginx-signing-{bootstrap,refusal}.conf`, `nginx-signing-host.conf.example`, `nginx-mainnet-ceremony.conf.example`, `cbob-ceremony@.service`, `CEREMONY-WINDOW.md`, `CEREMONY-INSTALL-RECEIPT.md`, `configure-rpc.py`. From the installed artifact `/opt/cbob-ceremony/a9dcaca…`: `check-ceremony-env.py`, `launch-ceremony.mjs`, `ceremony-build.mjs`, and the `ceremony-local` section of `ceremony-server.mjs` (lines 31874–32013). Also the ceremony page's `index.html` and the `connect()` function in its `app.js`, the live `/etc/nginx/sites-available/centralbankofbitcoin`, `conf.d/*`, the apex certbot renewal config, and the template syntax evidence JSON. I used only Read, Glob and Grep. I read no secret, environment file, htpasswd or PM2 dump content; for the dump I ran a match count only.

## Verdict

**Not ready to execute as written.** Stage 1 (DNS, certificate, refusal vhost) can go ahead once B1 (DNS write path) and B4 (one vhost file only) are settled. Stage 2 is blocked by B2, B3, B5, B6, B7 and B8. B9 must be fixed before the post-ceremony RPC step, though it does not block signing delivery itself.

## Blockers and defects

**B1 — Medium, readiness blocker (Stage 1 step 3): no confirmed way to write DNS.**
- `SIGNING-DELIVERY:17` says the ops credential can read the zone and that "write access is not assumed". Nothing in the plan covers the case where it cannot write.
- **Fix:** name the path before starting. Either Gary provisions a token scoped to Zone DNS edit for this one zone, or Gary creates the record himself with exact values (A record `sign`, 52.70.29.152, TTL 300, DNS-only). Then read it back by record ID.
- Also before issuing the certificate: read the zone's CAA records, and confirm the EC2 security group allows 80/443 from anywhere. If those ports only accept Cloudflare ranges, both the HTTP-01 challenge and direct delivery fail.

**B2 — High, blocker (Stage 2 step 4): the old ceremony process is under PM2.**
- `/home/ubuntu/.pm2/dump.pm2` matches `ceremony-local` (count 1).
- The plan says to stop the identified PID. If PM2 autorestart is on, killing it respawns the server from the mutable `/opt/cbob-vaults/web/deploy/ceremony-local.mjs` on port 8790. That respawn races the unit or takes the port first. If it is in mainnet-local mode it uses `localListener` with no proxy-secret check (`ceremony-server.mjs:31896`).
- A reboot (`pm2 resurrect`) brings it back the same way. So would the `reboot-verify` recovery script, which restarts apps missing compared with the last snapshot.
- **Fix:**
  - Find the supervisor. If it is PM2, check that the app's pid and script path match, then run `sudo -u ubuntu pm2 delete <exact name>` and `pm2 save`.
  - Confirm the dump count is now 0, and that port 8790 stays closed for at least 30 seconds before the unit starts.
  - Record that older `/opt/reboot-snapshots` files still list the app, so their recovery scripts must not be run as-is.

**B3 — High, blocker before Stage 2 step 5: nginx trusts whatever is listening on 127.0.0.1:8790.**
- The proxy secret proves nginx to the server, never the server to nginx (`ceremony-server.mjs:31923-31930`).
- The unit has `Restart=no` and `RuntimeMaxSec=5400`. After expiry, a crash or a stop, the signing vhost keeps sending Gary's basic-auth browser to port 8790. Any ubuntu process can then bind that port, for example the README's own command `node --env-file=… web/deploy/ceremony-local.mjs # 127.0.0.1:8790` (`web/README.md:380`), or the PM2 entry from B2.
- The plan checks that the listener PID equals MainPID only once, at step 4, and switches back to the refusal vhost by hand.
- **Fix:**
  - Automate the switch back. Either add a reviewed root `ExecStopPost=+` hook to the unit template, or add a root path/timer unit that watches the service. Either one installs the committed refusal vhost, runs `nginx -t` and reloads. The unit template is not part of the frozen artifact, so this is allowed after review.
  - Re-check MainPID equals the only 8790 listener immediately before sending the link and again when Gary starts.
  - Keep the authenticated vhost enabled only while the unit is active.

**B4 — Medium-High: two vhosts can claim the same server name, and `nginx -t` still passes.**
- The plan does not say the bootstrap, refusal and active vhosts are always the same single file. If two files declare `server_name sign.centralbankofbitcoin.com` on the same port, `nginx -t` prints only a "conflicting server name … ignored" warning and exits 0. Whichever file loads first wins.
- A rollback to "refusal" could then silently not take effect while the signing vhost is still served.
- **Fix:**
  - Use one file, `/etc/nginx/sites-available/cbob-signing`, with one symlink, and replace its contents atomically.
  - Treat any `conflicting server name` text in `nginx -t` stderr as a failure.
  - After every switch, confirm behaviour over real HTTPS (404 for refusal, 401 on the private path once active).

**B5 — Medium-High: the order of operations around the shared secret and nginx validity.**
- *Live secret file:* Stage 2 step 1 rotates `/etc/nginx/cbob-ceremony-proxy-secret.conf` while the live apex block still includes it (`centralbankofbitcoin:112`).
- *Shared nginx:* this nginx serves every production site on the box, and other sessions' deploys reload or restart it. Any moment when a referenced file on disk is invalid becomes a box-wide failure risk. A restart with a bad config takes every site down.
- *The legacy route is live now:* the apex block (`centralbankofbitcoin:110-131`) still serves a signing page built from the mutable tree, through the Cloudflare proxy. D2 requires delivery outside that proxy.
- **Fix:**
  - Move "legacy block → 410" plus the B2 shutdown to a Stage 0 that runs first. It depends on nothing else.
  - Give the signing location a new include file (for example `/etc/nginx/cbob-signing-proxy-secret.conf`, root:root 0600) instead of changing a file that is live.
  - Write every file to a temp name and rename it into place, then run `nginx -t` straight away and restore on failure.
  - The secret must be exactly 64 lowercase hex characters (`ceremony-server.mjs:31924`), otherwise the service refuses to start.
  - Forbid `nginx -T` in transcripts: it prints included files, which would expose the secret (security rule 68).

**B6 — Medium: where the unit template comes from.**
- `cbob-ceremony@.service` is not in the artifact's attested file set (`ceremony-build.mjs:73`). The plan would install it from the ubuntu-writable working tree, and its `ExecStartPre=+` runs as root.
- **Fix:**
  - Install from `git show <reviewed commit>:web/deploy/cbob-ceremony@.service` and check its SHA-256 against a hash recorded in this triage.
  - Run `systemd-analyze verify`.
  - Record the effective properties from `systemctl show`: DynamicUser, RuntimeMaxUSec, ProtectSystem, NoNewPrivileges, RestrictAddressFamilies, UnsetEnvironment, and confirm the unit is not enabled.

**B7 — Medium: the exact environment keys are not specified.**
- In systemd, `EnvironmentFile=` overrides `Environment=` (unit lines 7–10). If old keys are still in `ceremony.env`, the result is unpredictable:
  - a stale `CBOB_CEREMONY_COMMIT` fails closed;
  - `CBOB_LOCAL_PORT` other than 8790 makes nginx point at the wrong port;
  - an apex `CBOB_CEREMONY_ORIGINS` fails closed.
- systemd also ignores lines starting with `export `, which `configure-rpc.py:40` accepts.
- **Fix:**
  - Rewrite `ceremony.env` with exactly the four keys from step 2.
  - Audit all three files by key name only, never values, and check for no duplicates and no `export` prefixes.
  - Assert in-process, printing only a boolean, that the identity file's `CBOB_CEREMONY_ARTIFACT_SHA256` equals the owner-confirmed `d1b17742…`. Note the receipt says it was written before Gary confirmed.

**B8 — Medium: the temporary htpasswd user can outlive a dead session (Stage 2 step 6).**
- The `finally` cleanup will not run if the operator's session is killed or times out.
- **Fix:**
  - Before adding the entry, schedule a root cleanup with `systemd-run --on-active=15m` that removes that exact username's line.
  - Edit the file in Python, keeping its inode, owner and mode (root:www-data 0640).
  - Compare SHA-256 of Gary's line before and after.
  - Give curl the credentials on stdin with `-K -`, never `-u` on the command line.
  - nginx re-reads the htpasswd file on every request, so the removal is immediate. Verify the temp user gets 401 afterwards.

**B9 — Medium (blocks the post-ceremony RPC step, not signing): `configure-rpc.py` will refuse the new file ownership.**
- `configure-rpc.py:43` refuses any group or other permission bits, and `:45` requires the owner to be ubuntu.
- The plan sets `rpc-proxy.env` to root:ubuntu 0640, which `check-ceremony-env.py:9` requires.
- So the planned `CBOB_VAULT_COLLECTION` configuration after step 0 will be refused. Flipping ownership back would then make the next unit start refuse.
- **Fix:** have reviewed changes to `configure-rpc.py` accept and preserve root:ubuntu 0640 before launch week.

**B10 — Medium: timing of the 90-minute window.**
- The 5,400 seconds start at Stage 2 step 4. Steps 5–8 and Gary's acceptance use up that time, and signing is recommended for Thursday (RULINGS:58).
- **Fix:**
  - Label today's run as a delivery verification only.
  - Write down the exact re-run checklist for the signing window: artifact reverify with the digest equality check, env metadata and keys, listener PID, vhost file hash, certificate fingerprint and expiry, served-byte comparison, 401/404/410 checks, origin refusal, genesis read, and the chain preflight.
  - Keep the refusal vhost in place between the two runs.

**B11 — Low-Medium: the active vhost is not a committed file.**
- The template uses `/var/www/acme` with no `try_files` (`nginx-signing-host.conf.example:7`). The plan renders it with a different path, so the installed file is not byte-reviewed.
- **Fix:** commit the exact active vhost (it holds no secret; the private path is in the include), syntax-test it with the same fixture method, install it byte-identical, and record only the include's hash.

**B12 — Low:**
- The server already sets `x-frame-options` and `x-content-type-options` (`ceremony-server.mjs:31911-31912`), and nginx adds them again, so they are sent twice. Add `proxy_hide_header` for both, or have the byte checks assert exactly one Cache-Control and identical duplicate values.
- `access_log /var/log/nginx/cbob-ceremony.access.log` records the private path and the basic-auth username. Keep log output out of transcripts.

**B13 — Low: certificate and DNS lifecycle.**
- No renewal hook exists, for this certificate or the apex one, so nginx is not reloaded after a renewal. That does not matter this week.
- After DNS is removed, `certbot renew` will fail for this certificate every run. Plan `certbot delete --cert-name sign.centralbankofbitcoin.com` when the refusal vhost is finally retired.
- Certificate Transparency publishes the hostname within minutes, so expect scanning.
- A direct A record publicly ties 52.70.29.152 to the Cloudflare-proxied sites on this box. Record whether that IP was already public, as an accepted D2 trade-off.
- Earlier lookups may have cached NXDOMAIN, up to the SOA minimum TTL.

## Missing verification (add to Stage 2 steps 6–7 and Gary's checklist)

- Request 127.0.0.1:8790 directly with no `X-CBOB-Ceremony` header and with a wrong one; both must return 403.
- `/PATH/`, `/PATH/ceremony-<hex>` with no trailing slash, `/PATH/vault/app.js`, and `/PATH/rpc?x` must all return 404 behind authentication.
- The apex `/initialize-…/` must return 410 both through Cloudflare and directly to the origin with apex SNI.
- `nginx -t` stderr must contain no warnings.
- Port 80 on `sign` must redirect, and the ACME path must still answer once the vhost is active.
- **Gary's browser:**
  - The page fetches `../rpc`, which is outside the directory where the browser was challenged (`app.js:22529`). curl with explicit credentials cannot prove Brave re-sends the cached basic-auth credentials there.
  - So "chain reads load in the page in Brave with Phantom connected, no extra prompt" must be on Gary's acceptance list.
- **Owner verification JSON:** the digests match the receipt and `CEREMONY-WINDOW.md:82` (source `a9dcaca`, artifact `d1b17742…`, snapshot `8b6263c3…`). It does not record the GitHub run's workflow ref, or which file-level hash Gary could compare against the page footer's app.js hash `9e58b83c…`. Add both if Gary is expected to cross-check what is served.

## Confirmed as stated

- The hosted listener allows only `/rpc`, `BUILD.txt`, `assets/style.css` and `ceremony-<hex>/(index.html|app.js)`, plus the pinned-manifest check (`ceremony-server.mjs:31942`, `:31905`).
- The hosted profile refuses every origin except `https://sign.centralbankofbitcoin.com` (`:31971`).
- The rate zone `cbob_ceremony` exists (`conf.d/11-cbob-ceremony-rate.conf`).
- The real nginx symlink is enabled; `/etc/nginx/sites-available/centralbankofbitcoin` is live. Glob skips the symlink in `sites-enabled`, which is what caused the earlier misreport.
- The real-IP trust list contains only Cloudflare ranges, so direct clients keep their real address.
