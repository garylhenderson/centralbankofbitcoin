#!/usr/bin/env bash
# Isolate the read-only timer at the exact reviewed source before refreshing public data.
set -euo pipefail
cd /opt/cbob-vaults
[[ ( "${1:-}" = --prepare || "${1:-}" = --execute ) && "${2:-}" =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage: pin-public-data.sh --prepare|--execute <reviewed-commit>'; exit 1; }
[ "$(id -un)" = ubuntu ] || { echo 'Run as ubuntu.' >&2; exit 1; }
commit="$2"
[ "$(git rev-parse HEAD)" = "$commit" ] && [ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'Use the clean reviewed HEAD.' >&2; exit 1; }
git merge-base --is-ancestor "$commit" origin/v6
source="/opt/cbob-public-data/$commit"
sudo install -d -o ubuntu -g ubuntu -m 755 /opt/cbob-public-data
if [ ! -d "$source" ]; then git worktree add --detach "$source" "$commit"; fi
python3 "$source/web/deploy/run-public-data.py" --check
unit=$(mktemp /tmp/cbob-data-unit.XXXXXXXX)
smoke=$(mktemp /tmp/cbob-data-smoke.XXXXXXXX)
trap 'rm -f "$unit" "$smoke"' EXIT
exec 8>/opt/cbob-vaults/.cache/public-data.flock
flock -w 10 8 || { echo 'Public-data refresh is busy; previous source retained.' >&2; exit 1; }
if ! /usr/bin/node "$source/bank/vault-index.mjs" --dry > "$smoke" 2>&1; then
  echo 'Read-only snapshot smoke check failed; previous timer source retained.' >&2
  exit 1
fi
[ "$1" != --prepare ] || { echo 'Pinned source imports and read-only snapshot passed; timer unchanged.'; exit 0; }
cat > "$unit" <<UNIT
[Service]
WorkingDirectory=$source
ExecStart=
ExecStart=/usr/bin/flock -n /opt/cbob-vaults/.cache/public-data.flock /usr/bin/python3 $source/web/deploy/run-public-data.py
UNIT
sudo python3 "$source/web/deploy/activate-public-data.py" "$source" "$unit"
printf 'Public-data timer pinned to %s; no timer was armed.\n' "$commit"
