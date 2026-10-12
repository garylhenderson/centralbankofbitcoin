# Private signing delivery verified, 12 October 2026

Completed at 2026-10-12T17:19:43.424810+00:00.
This is read-only technical delivery acceptance, not a signature or launch.

## Bound identities

- Owner-confirmed artifact source: `a9dcaca08e6db389a24333009d7008ba8c9d235d`.
- Artifact SHA-256: `d1b17742d19a1082f89f0d6bb105e69ac5a6a3da575602d6e62b883da5b94b9f`.
- Installed delivery source: `cb90612cb9404de4d253725d229cb2b1e0b131a0`.
- Installer SHA-256: `cd8c15febd118e3db5f575d4d6bd052afde55512624178b384c225847148011c`.
- Passing harness source: `2376133ee1bcbbe027cfc914089b620a2707583e`.
- Harness SHA-256: `0d61463b3be3ff34440a127650ba3e3038c7ffdbe3f285bd472f24342429f8fa`.
- Live report SHA-256: `8008cb003f59e65482cee05218f1be8f7cf1e82846bca16c6a4d387700a08373`.

Both operational scripts ran as root-owned mode-0400 copies extracted from the
explicit pushed git objects, under Python `-I`. Installer checked all seven hardcoded
source pins before mutation. Final installed file hashes still match root state.
The immutable artifact and frozen programs were not modified.

## Passed live checks

The adjacent JSON records 37 checks: authenticated HTTPS bytes for BUILD.txt,
HTML, app.js and CSS; required headers; missing/wrong loopback secret refusal;
root/unlisted/malformed-path refusal; real mainnet genesis read; wrong-origin and
forbidden-read refusal; removal of temporary credentials; unchanged permanent
Gary auth bytes/inode/uid/gid/mode; normal stop, forced process exit, startup
failure, rapid closures and lock contention; recovery to exact refusal bytes;
HTTP redirect, ACME webroot, direct DNS and old apex 410 at edge and origin.

The first run safely stopped on a harness-only truncated genesis expectation
after page bytes/headers passed. The expected value was corrected to the full
canonical configuration value with a regression test, committed and pushed.
The rerun passed. Its incomplete predecessor is retained root-only at
`/var/backups/cbob-signing/delivery-verification-incomplete-ef562ca.json`.

Claude's final delta cleared the installer and core safety design and requested
the readiness retry correction. That correction is committed in ef562ca, tested
for recovery, exhaustion and unexpected errors. MainPID verification delegates
to the already-reviewed activation helper. All reviews used the direct Claude
subscription; no OpenRouter or paid API fallback was used.

## Final state verified after the run

- Ceremony and refusal units: inactive/dead, Result=success, static (not enabled).
- Port 8790 closed; runtime gate and runtime auth file absent.
- No instance drop-ins. Verification timer not found; no test timer remains.
- One signing vhost, exact committed refusal bytes; HTTPS returns 404.
- DNS API re-read confirms the exact A record is still DNS-only, origin52.70.29.152.
- Public home, market and governance HTML hashes match the pre-delivery snapshot.
- Public data timer active, last observed service success/0 at 17:11:09 UTC.
- No holder/trading switch, migration, transaction, signature, authority change
  or public-page publish occurred.

## Remaining before an owner signing window

Run the fresh artifact/env/certificate/listener/served-byte and chain preflight
checklist in `launch/SIGNING-DELIVERY-2026-10-12.md`. Verify the timer is absent and
there are no drop-ins. Gary must still perform the real Brave/Phantom acceptance,
including sibling RPC reads without an extra Basic Auth prompt. No automated
check certifies that browser behavior. Ninety-minute expiry is configured and
its shutdown hooks tested; elapsed 90-minute expiry was not separately waited out.

The existing `configure-rpc.py` root:ubuntu0640 compatibility finding B9 remains
for the next batch before post-ceremony collection configuration. Holder/member
integration and trading release acceptance remain separate unfinished work.
Thursday signing is a recommendation, not a booked or completed ceremony.
