# Private signing-host delivery operation

Owner confirmation is recorded in `ceremony-owner-verification.json`. The
independently rebuilt artifact is installed at
`/opt/cbob-ceremony/a9dcaca08e6db389a24333009d7008ba8c9d235d` with digest
`d1b17742d19a1082f89f0d6bb105e69ac5a6a3da575602d6e62b883da5b94b9f`.
No artifact code or frozen program is changed by this delivery operation.

This plan and its templates require Claude triage, commit and push before use.
The owner's D2 ruling already authorizes the private direct host; do not ask for
the same policy approval again. No transaction is signed or sent in these checks.

## Observed starting state

- Cloudflare zone `3c726312ca8cfcc3099f10a2500e0dd8` is active for
  centralbankofbitcoin.com. No records exist for sign.centralbankofbitcoin.com.
  The existing ops credential can read this zone; write access is not assumed.
- nginx currently tests successfully. Its enabled Bank symlink resolves to
  `/etc/nginx/sites-available/centralbankofbitcoin`. Exactly one authenticated
  legacy location proxies to 127.0.0.1:8790. Other upstreams and pages must stay
  byte-for-byte unchanged when that one block is replaced by a 410 refusal.
- The existing ceremony listener is PID 640933, node with script
  `/opt/cbob-vaults/web/deploy/ceremony-local.mjs`. Recheck before stopping it.
  Do not stop by port alone or kill an unrelated process.
- Existing basic auth names user gary; its file is root:www-data 0640 at
  `/etc/nginx/cbob-mainnet-ceremony.htpasswd`. Preserve Gary's password.
  The proxy-secret include is root:root 0600. Never print either content.
- `/etc/cbob` is root:ubuntu 0750. Existing RPC and ceremony env files are
  ubuntu-owned 0600. The artifact identity is already root:root 0600.
- Certbot is installed. Existing ACME account
  `9e4aea5375289480c72655550020dcad` is available. There is no signing certificate
  or installed `cbob-ceremony@` unit template yet.

## Stage 0: retire the legacy signing route first

1. Back up the affected files to a new root-only directory below
   `/var/backups/cbob-signing/`. Never print included secrets or run `nginx -T`.
2. Replace exactly the apex location identified by its expected port-8790
   upstream and auth file with the same location prefix returning 410. Parse
   balanced braces; assert all other bytes remain unchanged. Write atomically,
   run `nginx -t`, restore on failure, then reload. Existing unrelated OCSP
   warnings are a recorded baseline; conflicting server-name warnings or new
   signing warnings are failures. Verify 410 through both Cloudflare and direct
   origin SNI without printing the private path.
3. The supervised app is `cbob-mainnet-ceremony`. Re-read PM2 data in memory,
   emitting only its name, PID, executable, status and expected-script boolean.
   Assert PID 640933 and the exact ceremony-local.mjs argument still match, then
   `pm2 delete cbob-mainnet-ceremony` as ubuntu and `pm2 save`. Assert both live
   process metadata and the saved dump have no ceremony-local entry; check
   port 8790 remains closed for 30 seconds. Do not kill by port. Older reboot
   snapshots may still name this retired app: do not run their recovery as-is.

## Stage 1: DNS and certificate, no signing service

1. Recheck expected state, then create a root-only backup directory under
   `/var/backups/cbob-signing/`. Copy only affected nginx/env/auth files and
   record prior metadata, the absent unit/vhost states and DNS response. Keep
   secrets out of logs, the repository, command arguments and messages.
2. Install committed `nginx-signing-bootstrap.conf` as a new root-owned vhost
   `/etc/nginx/sites-available/cbob-signing`, with exactly one enabled symlink. Bootstrap, refusal and active states always
   replace this SAME file atomically; never add a second signing vhost. Reject
   `conflicting server name` even when `nginx -t` exits zero. Create
   root-owned webroot `/var/www/cbob-signing-acme`. Test nginx before reload.
   It serves only ACME challenges, otherwise 404. No TLS route or upstream yet.
3. Re-read exact DNS name. If still absent, create one A record pointing to
   the documented origin 52.70.29.152, TTL 300, `proxied:false`. Use the ops
   credential in memory only. Record its ID for rollback. A timeout requires
   a read-back before any retry. Never alter other records or proxy settings.
   The owner already authorized this one record. Attempt that narrow write with
   the existing credential. If it returns a permission error, leave the harmless
   bootstrap in place and request only the missing DNS permission or this exact
   owner-created record; never try alternative credentials silently.
4. Verify authoritative and recursive A answers; no conflicting AAAA/CNAME.
   Read CAA for sign and its parent before issuance. A direct origin probe plus
   the external ACME HTTP-01 validation must succeed; local probes alone do not
   establish public reachability. Test the exact ACME challenge path using a temporary harmless marker, then
   remove that marker. Request only this certificate with certbot `certonly
   --webroot -w /var/www/cbob-signing-acme -d sign.centralbankofbitcoin.com
   --cert-name sign.centralbankofbitcoin.com --non-interactive --agree-tos
   --account 9e4aea5375289480c72655550020dcad`. Do not use the nginx plugin.
5. Install the committed refusal vhost, test nginx and reload. Check trusted
   certificate chain, SAN, expiry and SHA-256 fingerprint using a real TLS
   connection. The apex certificate is never copied. Test 404 over TLS before
   considering an authenticated signing route.

## Stage 2: isolated service and authenticated delivery check

1. Prepare a new unlisted outer path. Render the existing reviewed
   `nginx-mainnet-ceremony.conf.example` with that path into the root-only
   location include. Reuse Gary's basic-auth entry. Create a NEW `/etc/nginx/cbob-signing-proxy-secret.conf` root-only include,
   with an exactly 64-character lowercase-hex secret shared with ceremony.env.
   Never modify the old include. Write files atomically without printing secrets.
   The new dedicated TLS vhost uses the existing signing-host template, with
   ACME root `/var/www/cbob-signing-acme`. Keep its root location 404.
2. Rewrite ceremony.env with exactly four keys and no others: profile mainnet-hosted, origin
   https://sign.centralbankofbitcoin.com, auth nginx-basic and fresh proxy
   secret. Preserve the RPC endpoints in their existing file. Set RPC env to
   root:ubuntu 0640 and ceremony env to root:root 0600. Metadata-check all three
   environment files with the artifact's check script. Read-only ubuntu jobs
   must still be able to read the RPC file. Audit all three env files by key name
   only: no duplicates, no export prefixes, no stale commit or port overrides.
   Assert the identity digest equals the owner-confirmed digest in memory and
   print only the equality boolean.
3. Stage 0 must already be complete. Install the exact reviewed unit and
   shutdown helper from explicit committed git objects, recording source SHA-256
   values. The helper must close the signing route automatically on normal stop,
   startup failure, crash and 90-minute expiry. Stage 2 is blocked until Claude
   reviews that implementation and its tests. Do not install the old unit alone.
4. Verify installed bytes and run `systemd-analyze verify`, then daemon-reload
   without enabling anything. Reverify the artifact and start only the reviewed
   instance. Record effective DynamicUser, RuntimeMaxUSec, ProtectSystem,
   NoNewPrivileges, RestrictAddressFamilies and UnsetEnvironment. Verify MainPID
   is exactly the sole loopback port-8790 listener immediately before activation.
5. Switch only the dedicated signing vhost from refusal to the prepared
   authenticated location, test nginx and reload. No public document is copied.
6. Verify nginx authentication (401 without it), correct origin, no-store /
   no-transform and isolation headers. A temporary random verification user
   may be appended to the existing htpasswd for automation ONLY after scheduling
   an independent root cleanup with `systemd-run --on-active=15m` to remove that
   exact random username. Preserve inode, owner, mode and Gary's entry hash; pass its password
   by stdin/in-memory only, never argv/logs. Always remove that entry in finally
   and verify Gary's original entry bytes are unchanged. Never leave a test
   credential enabled. Verify the removed test user returns 401.
7. Through HTTPS, compare served BUILD.txt, ceremony HTML/app.js and style.css
   byte-for-byte to the installed manifest. Verify host root, other artifact
   pages, unexpected files and malformed paths refuse; the old apex route must
   refuse. Test RPC with harmless genesis reads only, and prove wrong Origin
   and forbidden methods refuse. Direct requests to 8790 with missing/wrong proxy secret must be 403.
   Authenticated outer root, ceremony slug without its slash, vault/app.js and
   rpc?x must be 404. Check HTTP redirect and ACME challenge handling. No
   transaction-building or send call is used.
   Check DNS remains direct and responses lack Cloudflare rewriting/edge headers.
8. Record certificate fingerprint, artifact digest, service metadata, response
   results and remaining owner-browser checks. Do not claim real Brave/Phantom
   acceptance until Gary performs it. Give the private link only after checks
   pass and an owner window is ready; use the established credential channel,
   never SMS a password. This operation opens only a brief automated delivery
   verification window. After its checks, stop the instance and restore the
   TLS refusal vhost until the owner-browser/signing window is ready.

## Failure and expiry

On service or delivery failure, stop the new instance and switch the signing
vhost to the committed TLS refusal template, testing nginx before reload. Do
not restore the mutable old apex signing route. The public Bank pages and their
other routes remain unchanged. Before a certificate exists, remove only the
newly created DNS record and bootstrap vhost if abandoning setup. Keep backup
and failure evidence. Never overwrite or delete the installed artifact.

The service expires after 90 minutes and is not enabled at boot. If the owner
is not ready, stop it and leave TLS refusal in place; restart a reviewed window
only with fresh checks. No claims, trading, database migration, initialization
or program lock occurs here. The in-window chain preflight and Friday R1 gate
remain mandatory regardless of delivery success.

## Repeat for the real owner window

Reverify artifact and independent digest, environment keys/metadata, exact unit
and vhost hashes, certificate fingerprint/expiry, sole-listener MainPID, served
bytes, 401/404/410 behavior, origin refusal and genesis read. Run the fresh chain
preflight minutes before signing. Gary must verify in Brave with Phantom that
chain reads load without a second basic-auth prompt; curl cannot prove browser
credential caching. No owner acceptance is inferred from automated checks.

## Lifecycle and review disposition

The direct hostname/IP and certificate transparency disclosure are part of the
approved D2 direct-host choice. Keep the Core watcher and existing public jobs.
When retiring delivery, stop the service, leave refusal until DNS is removed,
then remove only this vhost/certificate. If maintained longer, arrange nginx
reload after certificate renewal. B9 (`configure-rpc.py` ownership compatibility)
must be fixed before the post-ceremony collection configuration, not before the
refusal-only Stage 1. The source artifact remains unchanged.

Claude's first delivery review is preserved as `SIGNING-DELIVERY-REVIEW.md`.
Stage 0 implements B2/B5; the one-file rule implements B4. B1 uses the existing
owner-authorized narrow DNS write, with permission-failure handling above.
Stage 2 remains gated on the shutdown-helper implementation and its triage.
