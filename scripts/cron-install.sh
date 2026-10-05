#!/usr/bin/env bash
# Install the CBOB vault operational crons.
#
# MINUTES ARE DELIBERATE. :00 already carries ~19 jobs on this box and a pile-up
# there once tripped PM2's memory ceiling and silently killed the heaviest job in
# flight. These sit on odd minutes, off the */5, */10 and */30 ticks.
#
# v6 (2026-10-03): NOTHING THIS FILE INSTALLS MOVES MONEY UNTIL YOU ARM IT.
#
# v5 installed `distribute.mjs`, which loaded the distributor key and sent cbBTC
# from the next 09:07 — opt-OUT, the dangerous direction. v6 deleted that job and
# that key: the MINT program pays the vaults itself. Both jobs left that send
# anything are opt-IN:
#
#   revenue.mjs  the one trusted hop (royalty SOL -> cbBTC). Gated by `--live`.
#   crank.mjs    reveal, activate, distribute (free monthly path), deliver
#                claims. Every instruction it sends is permissionless and pins
#                its own destination; its key pays fees and each reveal's Core
#                attribute rent (~0.0001 SOL, round 23 L14). Gated by `--live`.
#
# ⚠️ ON A RE-RUN a tagged, uncommented `--live` on either is PRESERVED (and
# nothing else arms it: a commented-out line, a prose note or another project's
# line never does — round 19). This script prints the resolved posture at the
# end, computed from the crontab it actually wrote. That print is the authority,
# not this paragraph.
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
# A rehearsal has remapped paths but shares this host's crontab and logrotate.
# Refuse before either can be read or changed, including preserved --live jobs.
[ ! -e "$R/REHEARSAL-RECORD.txt" ] || { echo "rehearsal tree: cron installation is disabled" >&2; exit 1; }
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
# ⚠️ NOT /var/lock. MEASURED on this box: `/var/lock` is a symlink to `/run/lock`,
# which is a 5 MB **tmpfs** — so the directory is GONE after every reboot, `flock`
# exits 1 with "No such file or directory", and every money cron silently stops
# running until a human notices. The deadman pages for the watcher; distribute and
# revenue have no equivalent.
#
# That is the durable answer for the lock, installed in the one directory that
# does not survive the event (a reboot) which most often leaves a stale in-process
# lock behind. Found by a round-16 auditor and confirmed with `readlink -f`.
#
# NOT $LOGDIR either: logrotate acts on that directory and a rotated-away lock
# file is a lock nobody holds. NOT /tmp, which is world-writable.
LOCKDIR=$R/bank/locks
sudo install -d -o ubuntu -g ubuntu -m 750 "$LOCKDIR"
sudo install -d -o ubuntu -g ubuntu -m 750 "$LOGDIR"
TMP=$(mktemp)
CUR=$(crontab -l 2>/dev/null || true)

# ⚠️ ROUND 19 — READ OUR OWN TAGGED, UNCOMMENTED LINES. NOT THE WHOLE CRONTAB.
# This grep used to run over `$CUR` as unstructured text. Measured: a
# COMMENTED-OUT revenue line — which is the ordinary way an operator DISABLES a
# cron — a prose note in a comment, or another project's line all matched, and
# every one of them armed `--live` on the one trusted hop. Text that expresses
# the OPPOSITE intent was read as consent to arm money.
# The preserve exists for a deliberate operator choice on OUR line, so it has to
# read OUR line: tagged, and not commented out.
# ⚠️ MATCH THE SPECIFIC TAGGED JOB, NOT ANY TAGGED LINE. A round-19 auditor
# caught this in the round-19 repair: the posture print at the bottom of this
# file greps `"$TAG distribute"` and `"$TAG revenue"`, while these preserves
# grepped only `$TAG` and then a substring — two strictnesses for one question,
# in one file, in one change. That is the same one-of-N defect this repair
# exists to close, committed inside it. `ours <job>` takes the job name.
# ⚠️ ROUND 24 (L12): AND MATCH IT TO THE END OF THE LINE. `grep -F "$TAG crank"`
# also matched `$TAG crank-reveal`, so a reveal line hand-armed as `--live
# --reveal-only` armed the full hourly pass on the next reinstall, while the
# alarm's `crankArmed` (anchored, `crank\s*$`) said it was not armed. One
# question, one strictness: the tag, the job name, then only trailing space.
ours() { grep -E -- "$TAG $1[[:space:]]*\$" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
REV_LIVE=''
if ours revenue | grep -q 'revenue\.mjs --live'; then
  REV_LIVE=' --live'
  echo "NOTE: the existing revenue cron is --live; keeping it."
fi
# THE CRANK, THE SAME WAY — and one of two identical sites is this repository's
# signature defect, so it is the same function with the same strictness. One flag
# arms BOTH crank lanes (the every-minute reveal and the hourly full pass); it is
# read off the full-pass line, the one an operator arms deliberately.
CRANK_LIVE=''
if ours crank | grep -q 'crank\.mjs --live'; then
  CRANK_LIVE=' --live'
  echo "NOTE: the existing crank cron is --live; keeping it."
fi

# Filter on the TAG, which is on every line we write and nothing else.
# ⚠️ ROUND 25 (L4): REVENUE RUNS HOURLY. It ran at `41 */6`, and the ruled
# sweep cooldown is also 6 h. `last_sweep_at` is the chain time the sweep landed,
# a few round trips after its run began, so every next run started a second or
# two BEFORE `last + cooldown`, printed "cooldown" and returned: a 12 h cadence,
# half the ruled throughput, made permanent by the tighten-only vote. Hourly, the
# cooldown gate (on the chain's clock) makes the extra runs no-ops. bank/
# detectors.mjs REVENUE_CRON_PERIOD_SECS states this period, and the selftest
# holds this line to it and to a period shorter than the ruled cooldown.
grep -v "$TAG" <<<"$CUR" > "$TMP" || true
cat >> "$TMP" <<CRON
23,53 * * * * cd $R && mkdir -p $LOCKDIR && $FLOCK $LOCKDIR/alarm.flock /usr/bin/node bank/alarm.mjs >> $LOGDIR/alarm.log 2>&1 $TAG watcher
37 * * * * cd $R && mkdir -p $LOCKDIR && $FLOCK $LOCKDIR/crank.flock /usr/bin/node bank/crank.mjs$CRANK_LIVE >> $LOGDIR/crank.log 2>&1 $TAG crank
* * * * * cd $R && mkdir -p $LOCKDIR && $FLOCK $LOCKDIR/crank-reveal.flock /usr/bin/node bank/crank.mjs --reveal-only$CRANK_LIVE >> $LOGDIR/crank-reveal.log 2>&1 $TAG crank-reveal
41 * * * * cd $R && mkdir -p $LOCKDIR && $FLOCK $LOCKDIR/revenue.flock /usr/bin/node bank/revenue.mjs$REV_LIVE >> $LOGDIR/revenue.log 2>&1 $TAG revenue
19 4 * * * cd $R && mkdir -p $LOCKDIR && $FLOCK $LOCKDIR/reconcile.flock /usr/bin/node bank/alarm.mjs --reconcile >> $LOGDIR/reconcile.log 2>&1 $TAG reconcile
9 */2 * * * { [ ! -f $ALARM_STATE ] || [ -n "\$(find $ALARM_STATE -mmin +120 2>/dev/null)" ]; } && /opt/scripts/notify-gary-sms.sh "CBOB vault alarm state is missing or over 2 hours old - the watcher is not running, or its baseline has been deleted" cbob-vault-alarm:deadman $TAG deadman
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
echo "  watcher     approvals, PDA token accounts, burns, balance falls, config + program"
echo "              drift, an OVERDUE distribution, the pool (frozen / short), the 2.1%"
echo "              redemption bucket, the guardian's brakes, reschedules, frozen claims,"
echo "              the revenue account (frozen / unreadable / unsplit), royalty SOL left"
echo "              unswept a day, and an armed crank that stopped completing passes"
echo "  crank       hourly: retire bare burns, ACTIVATE vaults at >= 21,000 sats, run the"
echo "              free monthly distribution when due, DELIVER claims in batches of 14"
echo "  crank-reveal every minute: reschedule lapsed draws, capture entropy, reveal in"
echo "              mint order (the capture window is ~2 minutes)"
echo "  revenue     sweep -> swap -> return -> split. Gated by --live."
echo ""
# ⚠️ ROUND 19. THE SUMMARY USED TO STATE THE MONEY POSTURE UNCONDITIONALLY —
# "distribute is LIVE FROM THE NEXT 09:07 ... revenue is the only job this script
# leaves dormant". Both halves are now conditionally false: an operator's
# --dry-run is preserved on distribute, and a preserved --live arms revenue. A
# fixed sentence about a variable fact is the defect this project has shipped
# more than any other, so the posture is COMPUTED from the lines actually
# written rather than asserted. Read it, do not trust the prose above.
echo "  ⚠️  MONEY POSTURE AS INSTALLED — computed from the crontab just written:"
if crontab -l 2>/dev/null | grep -E -- "$TAG crank[[:space:]]*\$" | grep -v '^[[:space:]]*#' | grep -v -- '--reveal-only' | grep -q -- '--live'; then
  echo "      crank       LIVE. It sends reveals, activations, distributions and claims"
  echo "                  (fee payer: bank/keys/crank.json. Above 0.25 SOL it still runs and"
  echo "                  warns once a day: the excess is a honeypot to move, round 22 F8)."
  echo "                  Each LIVE full pass stamps bank/.crank-heartbeat; the watcher pages"
  echo "                  crank_silent when an armed crank has not stamped it in 3 hours."
else
  echo "      crank       DRY-RUN. It plans every minute/hour and sends nothing."
  echo "                  Add --live to the crank line when ready (both lanes follow it)."
fi
if crontab -l 2>/dev/null | grep -E -- "$TAG revenue[[:space:]]*\$" | grep -v '^[[:space:]]*#' | grep -q -- '--live'; then
  echo "      revenue     LIVE. The trusted hop will sweep, swap and return."
else
  echo "      revenue     DORMANT. Add --live when ready."
fi
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
echo "  crontab -l | grep -cF '$TAG'   # must be 6, and must STAY 6 after a re-run"
