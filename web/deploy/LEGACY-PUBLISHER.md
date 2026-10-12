# Retired publishers

`/home/ubuntu/cbob-site-build/deploy.sh` copied the old site to the live root with
`rsync --delete`. The yearly weights-release cron formerly invoked that path. Gary approved D9
on October 12 UTC; its single exact cron entry was removed and read back.
The entrypoint still refuses to run. See the retirement receipt in
`audits/rulings-2026-10-12/LEGACY-CRON-RETIREMENT.json`.
`/tmp/claude-1000/golive.sh` is also retired and must never be executed.

Install procedure: save the original files with owner, mode and sha256 into a
unique root-private directory under `/var/backups/cbob-retired-publishers/`.
Install the committed `legacy-publish-retired.sh` at both existing entrypoints.
Record the backup directory and installed stub hash in the remediation receipt.
Do not print original script content, which may include operational credentials.

To reverse deliberately: verify the recorded original hash, restore that one
file with its recorded owner and mode, and review its callers before enabling it.
Restoring the old script restores its destructive behavior. Prefer the committed
`publish-ecosystem.sh --execute <reviewed-commit>` instead.

The /tmp stub is a precaution, not a durable launch path. It is never scheduled.
The committed `go-live.sh` is the future relay launch path, gated on a real
collection and review. It performs no initialization, lock or cron enablement.
