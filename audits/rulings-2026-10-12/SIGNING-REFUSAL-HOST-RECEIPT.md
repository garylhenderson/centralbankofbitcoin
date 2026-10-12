# Refusal-only private host installed, 12 October 2026

Owner-confirmed signing artifact remains unchanged and inactive. Delivery source
`fbad5be` was committed and pushed before installation. No signature, transaction,
program upgrade/lock, holder action, trading switch or public-page publish ran.

- Exactly one old apex location was replaced with 410; bytes outside that block
  are unchanged. Edge and direct-origin HTTPS both returned 410 after reload.
- The expected `cbob-mainnet-ceremony` PM2 process (PID 640933, exact script
  argument verified) was deleted and PM2 state saved. Both live/saved metadata
  exclude it. Port 8790 remained closed during 31 checks over 30 seconds.
- An owner-authorized DNS-only A record points sign.centralbankofbitcoin.com to
  52.70.29.152, TTL 300. API read-back and authoritative/public DNS agree. No
  other record was edited. CAA lookups found no restriction; no AAAA or CNAME.
- Certificate HTTP-01 validation succeeded from the external ACME service. Its
  own trusted certificate covers only the signing hostname and expires
  10 January 2027. Fingerprint and DNS record ID are in adjacent JSON receipts.
- One root-owned vhost, one enabled symlink. Bootstrap was replaced atomically
  with committed TLS refusal; `nginx -t` passed without conflicting-server-name
  warnings. Existing unrelated OCSP warnings were not changed.
- HTTPS root and an arbitrary path return 404. No signing unit is installed yet.
- Reload is asynchronous: the first immediate route/certificate checks reached
  old workers; subsequent fresh connections verified 410 and the correct trusted
  signing certificate. These were not accepted until the new state was observed.
- Home, market and governance HTML SHA-256 values exactly match the before
  snapshot. Public data timer is active; last service exit was success/0 at
  16:50:46 UTC. Holder actions and trading remain off.

Root-only backup: `/var/backups/cbob-signing/20261012T165032Z`.
Do not resurrect the retired PM2 app from older reboot snapshots. Automatic
shutdown and temporary credential cleanup are undergoing separate Claude
subscription reviews before any authenticated delivery test. Brave/Phantom
owner acceptance and the fresh in-window chain preflight remain outstanding.
