#!/usr/bin/env bash
# Install the CBOB vault operational crons.
#
# MINUTES ARE DELIBERATE. :00 already carries ~19 jobs on this box and a pile-up
# there once tripped PM2's memory ceiling and silently killed the heaviest job in
# flight. These sit on odd minutes, off the */5, */10 and */30 ticks.
#
# NOTHING HERE MOVES MONEY UNTIL --live IS ADDED TO THE REVENUE LINE. It is left
# off on purpose: the revenue cycle is the one path with a trusted hop, and it
# should not start running unattended the moment a cron is installed.
#
# ROUND 6 — THE DE-DUPE FILTER NEVER MATCHED ITS OWN JOBS.
# It was `grep -v 'cbob-vaults/bank'`, and the installed line reads
# `cd /opt/cbob-vaults && /usr/bin/node bank/alarm.mjs` — the two halves are
# separated by ` && /usr/bin/node `, so that substring appears NOWHERE. Verified
# by piping the line through the filter: zero matches. Every re-run therefore
# APPENDED a second copy of all three jobs, so two `distribute.mjs` processes
# would fire at 09:07 on the same ledger. The jobs now carry an explicit tag and
# are filtered on that, and each money-moving job also takes an exclusive lock
# in its own code (bank/lock.mjs), because a crontab is not a safety mechanism.
#
# ROUND 15 — `flock -n`, AND WHY IT IS HERE RATHER THAN IN THE JOB.
# `bank/lock.mjs` is a pathname lock, and a pathname lock cannot compare-and-swap.
# Its break has now failed three rounds running in a narrower ordering each time;
# round 15 MEASURED a third runner claiming the pathname during the restore
# window and both it and the true holder paying. No arrangement of rename, link
# and unlink closes that — every one of them reduces to check-then-act.
#
# `flock(2)` on an open fd does close it. The kernel holds the lease, it needs no
# break because it is released when the holder DIES, and two racers cannot both
# get it. `flock -n` is util-linux, already on this box, and costs one prefix per
# line. So the unattended path — which is the path that actually runs, and the
# one nobody is watching — is now protected by the OS, and `bank/lock.mjs` is the
# in-process belt-and-braces plus the guard for a job someone runs by hand.
#
# `-n` and not a wait: two overlapping distribute runs must ABORT, never queue.
# A queued second run pays the same day twice as soon as the first one finishes.
# The exit code is 1 with nothing written, which is what the log should show.
#
# AND IT USED TO SILENTLY UN-`--live` THE REVENUE CRON: it stripped the old lines
# and re-added them from this heredoc, without whatever an operator had added by
# hand. The revenue line is now preserved if it already exists.
set -euo pipefail
# RUN AS ubuntu, NOT root. `sudo ./cron-install.sh` writes ROOT's crontab, where
# these jobs would run as the wrong user and the first run would be the one that
# told you. It only sudoes for the logrotate file, which does need root.
[ "$(id -un)" = "ubuntu" ] || { echo "run this as ubuntu, without sudo" >&2; exit 1; }
R=/opt/cbob-vaults
TAG='#cbob-vault-cron'
# NOT /tmp. It is world-writable, so any local user can pre-create a log file
# that root's logrotate then acts on, and a tmp cleaner can delete the record of
# what the watcher saw. The keys, both money ledgers and the watcher state all
# already live under one uid on this host; the logs at least do not have to sit
# somewhere anyone can reach.
LOGDIR=/var/log/cbob
# THE PATH THE ALARM ACTUALLY USES. It honours CBOB_ALARM_STATE, and a deadman
# hardcoded to the default would watch a file nobody writes while the real
# baseline was deleted underneath it — a watchdog on the wrong door.
ALARM_STATE="${CBOB_ALARM_STATE:-$R/bank/state.json}"
# THE OS LEASE. Assert it EXISTS before writing a crontab that depends on it —
# a missing `flock` would make every line fail with "command not found" and the
# money jobs would simply stop running, silently, at 09:07.
FLOCK=/usr/bin/flock
[ -x "$FLOCK" ] || { echo "$FLOCK is not executable — install util-linux; the crons depend on it for exclusion" >&2; exit 1; }
FLOCK="$FLOCK -n"
# NOT in $LOGDIR: logrotate acts on that directory and a rotated-away lock file
# is a lock nobody holds. NOT in /tmp either, for the reason above.
LOCKDIR=/var/lock/cbob
sudo install -d -o ubuntu -g ubuntu -m 750 "$LOCKDIR"
sudo install -d -o ubuntu -g ubuntu -m 750 "$LOGDIR"
TMP=$(mktemp)
CUR=$(crontab -l 2>/dev/null || true)

# Preserve an operator's --live on the revenue line rather than reverting it.
REV_LIVE=''
if grep -q "revenue.mjs --live" <<<"$CUR"; then
  REV_LIVE=' --live'
  echo "NOTE: the existing revenue cron is --live; keeping it."
fi

# Filter on the TAG, which is on every line we write and nothing else.
grep -v "$TAG" <<<"$CUR" > "$TMP" || true
cat >> "$TMP" <<CRON
23,53 * * * * cd $R && $FLOCK $LOCKDIR/alarm.flock /usr/bin/node bank/alarm.mjs >> $LOGDIR/alarm.log 2>&1 $TAG watcher
7 9 * * * cd $R && $FLOCK $LOCKDIR/distribute.flock /usr/bin/node bank/distribute.mjs >> $LOGDIR/distribute.log 2>&1 $TAG distribute
41 */6 * * * cd $R && $FLOCK $LOCKDIR/revenue.flock /usr/bin/node bank/revenue.mjs$REV_LIVE >> $LOGDIR/revenue.log 2>&1 $TAG revenue
19 4 * * * cd $R && $FLOCK $LOCKDIR/reconcile.flock /usr/bin/node bank/alarm.mjs --reconcile >> $LOGDIR/reconcile.log 2>&1 $TAG reconcile
9 */2 * * * { [ ! -f $ALARM_STATE ] || [ -n "\$(find $ALARM_STATE -mmin +120 2>/dev/null)" ]; } && /opt/scripts/notify-gary-sms.sh "CBOB vault alarm state is missing or over 2 hours old - the watcher is not running, or its baseline has been deleted" cbob-vault-alarm $TAG deadman
CRON
crontab "$TMP"; rm -f "$TMP"
echo "installed (tagged $TAG):"; crontab -l | grep -F "$TAG"
sudo tee /etc/logrotate.d/cbob-vaults >/dev/null <<ROT
$LOGDIR/*.log {
  su ubuntu ubuntu
  daily
  rotate 14
  compress
  missingok
  notifempty
  copytruncate
}
ROT
echo "logrotate: /etc/logrotate.d/cbob-vaults"
echo
echo "WHAT EACH LINE IS FOR"
echo "  watcher     approvals, PDA token accounts, burns, deactivations, config + program drift"
echo "  distribute  daily cbBTC to ACTIVATED vaults only (>= 21,000 sats), equal per vault"
echo "  revenue     sweep -> swap -> return -> split. ADD --live WHEN YOU ARE READY."
echo "  reconcile   STATE, not history: every token account each vault PDA owns."
echo "              The signature tail structurally CANNOT see one of these being"
echo "              created, because such a transaction touches none of our programs."
echo "  deadman     the watcher cannot report its own death. This is separate, is"
echo "              plain test(1) and find(1), and needs neither node nor our code."
echo "              It fires on a MISSING file as well as a stale one: \`find\` on a"
echo "              path that does not exist prints nothing, so the first version"
echo "              was silent about exactly the case that deletes the baseline."
echo
echo "VERIFY BY ARTIFACT, not by reading the config:"
echo "  sudo logrotate --debug /etc/logrotate.d/cbob-vaults | grep -iE 'error|duplicate'"
echo "  ls $LOGDIR/*.log.1.gz      # after the first rotation"
echo "  crontab -l | grep -cF '$TAG'   # must be 5, and must STAY 5 after a re-run"
