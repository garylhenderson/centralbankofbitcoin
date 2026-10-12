# Post-signing RPC configuration preparation, October 12

B9 is fixed in source. The configuration helper accepts the deployed
root:ubuntu 0640 relay environment and retains that exact ownership and mode
when adding the eventual collection address. The legacy ubuntu:ubuntu 0600
layout remains accepted with a warning; it is not suitable for the signing unit.

The helper refuses unsafe parents, symlinks, multiple links, FIFOs and unsafe
permissions. Backups record uid/gid/mode; restoration uses the recorded layout
even if the destination was deleted or recreated. Restoration preserves bytes,
and malformed UTF-8 errors cannot disclose environment content.

Ten tests passed with real root-owned temporary fixtures using
`sudo /usr/bin/python3 -I web/deploy/configure-rpc.test.py`. They do not touch
production configuration. Five shell-wrapper tests also pass with inert
commands in temporary directories: running/stopped/absent recovery, changed
source refusal, restore failure, publication failure, and successful release.
They verify that pm2 never inherits the release lock. Shell syntax and whitespace
checks also passed. These are not live pm2/nginx failure injections.

The release wrapper takes its lock before source checks, checks the reviewed
HEAD again before configuration and process changes, invokes isolated Python,
and attempts each configuration recovery step independently. It preserves a
previously stopped process. Publication and source code are explicitly outside
that configuration rollback; publication failure no longer rolls a healthy relay
back underneath pages that may already have been published.

Direct first-party Claude reviews are recorded alongside this file. No
OpenRouter or paid API fallback was used. The final delta review is recorded
in `RPC-PERMISSIONS-FINAL.md`. Its final A-D follow-ups are implemented:
changed source prevents root restore, the healthy process is saved before
publication, pm2 children cannot inherit the lock, and nginx reads use explicit
UTF-8 without newline conversion. Those last deltas are covered by the local
tests; they have not been re-audited or executed in production.

No production configuration helper or go-live execution occurred. The collection
does not exist yet, and no signing artifact, protected program, holder control or
trading control changed. Before eventual execution, retain the deployment review
gate: stronger immutable source execution, a live wrapper failure rehearsal,
the existing nginx real-IP scope check, strict Node-compatible environment
parsing, and backup retention/path allowlisting remain follow-ups from review.
This checkpoint is source preparation, not go-live approval.
