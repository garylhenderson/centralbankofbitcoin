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
set -euo pipefail
# RUN AS ubuntu, NOT root. `sudo ./cron-install.sh` writes ROOT's crontab, where
# these jobs would run as the wrong user and the first run would be the one that
# told you. It only sudoes for the logrotate file, which does need root.
[ "$(id -un)" = "ubuntu" ] || { echo "run this as ubuntu, without sudo" >&2; exit 1; }
R=/opt/cbob-vaults
TMP=$(mktemp)
crontab -l 2>/dev/null | grep -v 'cbob-vaults/bank' > "$TMP" || true
cat >> "$TMP" <<CRON
# ── CBOB vaults ──────────────────────────────────────────────────────────────
# the watcher: approvals, PDA token accounts, burns, deactivations, config drift
23,53 * * * * cd $R && /usr/bin/node bank/alarm.mjs >> /tmp/cbob-alarm.log 2>&1
# daily cbBTC to ACTIVATED vaults only (>= 21,000 sats), equal per vault
7 9 * * * cd $R && /usr/bin/node bank/distribute.mjs >> /tmp/cbob-distribute.log 2>&1
# revenue: sweep -> swap -> return -> split. ADD --live WHEN YOU ARE READY.
41 */6 * * * cd $R && /usr/bin/node bank/revenue.mjs >> /tmp/cbob-revenue.log 2>&1
CRON
crontab "$TMP"; rm -f "$TMP"
echo "installed:"; crontab -l | grep -A1 'CBOB vaults' | tail -n +2
sudo tee /etc/logrotate.d/cbob-vaults >/dev/null <<'ROT'
/tmp/cbob-*.log {
  su root root
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
echo "VERIFY BY ARTIFACT, not by reading the config:"
echo "  sudo logrotate --debug /etc/logrotate.d/cbob-vaults | grep -iE 'error|duplicate'"
echo "  ls /tmp/cbob-*.log.1.gz    # after the first rotation"
