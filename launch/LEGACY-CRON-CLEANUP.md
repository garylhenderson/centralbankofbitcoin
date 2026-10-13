# Two legacy scheduler leftovers

October 13 read-only inventory found a daily 09:07 entry for the deleted
bank/distribute.mjs and a separate hourly Notice reconciliation call putting its
CRON_SECRET header into curl's arguments. These are distinct from the new
cbob-portal-reconcile financial recovery service. Do not delete the Notice job
or change its recipient behavior while cleaning up the vault launch jobs.

After Claude review, merge/push to the production v6 branch and prepare the exact
public-data worktree, run as ubuntu:

`python3 web/deploy/cleanup-legacy-crons.py --execute FULL_REVIEWED_SHA`

The operation removes exactly one missing-script entry and replaces only the
Notice call, at the same minute 8 schedule and same localhost:3003 POST route.
The small Node caller reads the existing credential internally, follows no
redirect, has a five-minute timeout, never retries automatically and logs no
response body. It makes no model call itself. This operation does not invoke
the endpoint; the normal hourly schedule continues. No launch announcement or
test message is sent. The underlying endpoint's existing Notice behavior is
unchanged, and this cleanup is not a review of that older product's logic.

The caller uses the exact committed `/opt/cbob-public-data/FULL_SHA` worktree,
whose bytes are checked before installation, not the editing checkout. Retain
that worktree while the cron refers to it. A future caller change must be reviewed
and explicitly re-pinned. The installer checks the existing CRON_SECRET reference
and executable Node version (18 or later) before replacing the cron.

The Notice caller retains the existing ubuntu identity and original configuration
file access. Audit A5's isolated public-data and financial-recovery services are
separate; this A11 repair does not claim to isolate all Gary Club cron jobs.

Before/after crontabs are saved in a new private directory, never printed. The
installer checks exact source, expected schedule/origin, uniqueness, missing v5
target and unchanged crontab immediately before replacement. Every other line is
preserved byte-for-byte. It verifies the final crontab and records hashes only.
On an unexpected read-back, inspect the private backup and current state before
any restoration so another operator's concurrent edit is not overwritten.

The new log is private to ubuntu and contains only success/failure lines. The
existing revenue job stays in its observed non-live posture. The permissionless
payout crank remains prepared in source and unarmed until launch acceptance and
the owner's release approval. No cron installation command that could arm it is
part of this cleanup.
