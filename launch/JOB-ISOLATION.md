# Background job isolation (audit A5)

This batch changes only the two background jobs and their deployment support.
The public producer uses `cbob-data`; transaction recovery uses `cbob-reconcile`.
Both are login-disabled system users with no extra groups, strict read-only
filesystems, hidden home directories and no new privileges. No sudo grant is
installed. AWS's IPv4 metadata endpoint is denied.

Inside each service's private mount namespace, Gary Club's environment path is
replaced by a root-owned, limited credential file. The real Gary Club file is
unchanged. The producer gets the RPC, optional warehouse price settings, database
URL and service credential needed for the private order projection, plus the
public trading-status flag. Recovery gets only CRON_SECRET. Neither gets a wallet
encryption key, email key or other application credentials. The database service
credential is still broad: this is filesystem/process isolation, not a new
database role or a claim of read-only database authority.

Empty private mounts hide the rest of Gary Club, the Bank checkout and its cache;
only required libraries, git metadata, the caller and shared lock are mounted back.
The ceremony artifact and backup trees are inaccessible. The real systemd fixtures
prove sibling files remain hidden even when the fixture makes them world-readable,
and prove the lock bind references the original inode through the masked cache.

Public state moves to `/var/lib/cbob-public-data`, preserving the existing opened
ledger, financial cursor, metadata state and confirmed-sale cache. Only the two
public output directories, this state directory, private temporary space and the
existing shared producer lock are writable in the producer namespace. The operator retains deployment
access. The shared lock remains the original inode; it is not copied or replaced.

## Install after Claude review, commit and push

1. Pin the reviewed producer with `pin-public-data.sh --execute FULL_SHA`.
2. Run `sudo python3 -I web/deploy/install-job-isolation.py --execute FULL_SHA`.
   It requires both switches off, existing healthy/active schedules, clean pushed
   source and that exact producer pin. It stops only the two timers, waits for
   running jobs to finish, takes the existing flock, copies state, installs the
   narrow environments and service overrides, and runs both ordinary services.
   It resumes only the previously active timers. It never enables a new timer.
3. Independently check effective users/sandbox settings, limited credential names,
   fresh public JSON, output permissions, the original environment's unchanged
   hash and both timer results. Keep the root-private receipt.

If a check fails, the installer removes only its new overrides, reloads systemd
and restores the prior schedules. Prior cache files remain untouched. New state,
limited credentials, identities and the private failed receipt are retained;
the installer refuses replay. Output group permissions leave the old ubuntu
producer able to run. Inspect any state written by the new producer before
returning to the old cache. A failed restoration is explicitly reported.

Future publication preserves the dedicated output group. Its first refresh runs
in a transient service with the exact reviewed sandbox, not as the operator;
the named transient has a 480-second runtime limit. Its unit is explicitly stopped
and confirmed inactive even if the systemd-run client times out. An unverified
stop prevents automatic predecessor restoration and requests shutdown of the
producer/timer for manual recovery. A real timeout fixture verifies the unit and
its descendant die before return. The ordinary timer retains its existing timeout
and shared lock. The producer still checks the exact source
and dependency versions before application imports.

## Credential and release changes

These are deliberate scoped copies. Rotate their needed credentials alongside
the application credentials. When trading is explicitly released or stopped,
update CBOB_PORTAL_TRADING_ENABLED in the private public-data-reader.env as part
of that operation, then refresh and verify market.json against the running Gary
Club switch. A mismatch cannot enable settlement but can mislabel the public
status. Never copy the whole application environment into either scoped file.
Holder release needs no extra key in the public producer's file.

No holder action, email delivery, charter initialization or program lock is
enabled by this migration. A successful recovery job proves its caller works;
it does not prove real-wallet acceptance.
