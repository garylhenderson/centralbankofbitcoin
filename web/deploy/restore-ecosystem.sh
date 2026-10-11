#!/usr/bin/env bash
set -euo pipefail
cd /opt/cbob-vaults
[ "$(id -un)" = ubuntu ] || { echo 'Run as ubuntu, without sudo.' >&2; exit 1; }
[ "$#" = 1 ] || { echo 'Pass the backup directory.' >&2; exit 1; }
exec 9>/opt/cbob-vaults/.cache/publish.flock
flock -n 9 || { echo 'Another Bank publication is in progress.' >&2; exit 1; }
sudo python3 web/deploy/publish-files.py --restore "$1"
