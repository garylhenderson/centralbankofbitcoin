#!/usr/bin/env bash
# Isolate the read-only timer at the exact reviewed source before refreshing public data.
set -euo pipefail
cd /opt/cbob-vaults
[[ "${1:-}" = --execute && "${2:-}" =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage: pin-public-data.sh --execute <reviewed-commit>'; exit 1; }
[ "$(id -un)" = ubuntu ] || { echo 'Run as ubuntu.' >&2; exit 1; }
commit="$2"
[ "$(git rev-parse HEAD)" = "$commit" ] && [ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'Use the clean reviewed HEAD.' >&2; exit 1; }
git merge-base --is-ancestor "$commit" origin/v6
source="/opt/cbob-public-data/$commit"
sudo install -d -o ubuntu -g ubuntu -m 755 /opt/cbob-public-data
if [ ! -d "$source" ]; then git worktree add --detach "$source" "$commit"; fi
python3 "$source/web/deploy/run-public-data.py" --check
unit=$(mktemp /tmp/cbob-data-unit.XXXXXXXX)
trap 'rm -f "$unit"' EXIT
cat > "$unit" <<UNIT
[Service]
WorkingDirectory=$source
ExecStart=
ExecStart=/usr/bin/flock -n /opt/cbob-vaults/.cache/public-data.flock /usr/bin/python3 $source/web/deploy/run-public-data.py
UNIT
sudo python3 - "$unit" <<'PY'
import pathlib, shutil, subprocess, sys, tempfile, os
unit=pathlib.Path(sys.argv[1]); folder=pathlib.Path('/etc/systemd/system/cbob-public-data.service.d'); folder.mkdir(exist_ok=True)
target=folder/'50-reviewed-source.conf'
backups=pathlib.Path('/var/backups/cbob-public-data'); backups.mkdir(exist_ok=True)
backup=pathlib.Path(tempfile.mkdtemp(prefix='source-',dir=backups)); previous=target.exists()
if previous: shutil.copy2(target,backup/'50-reviewed-source.conf')
try:
 fd,tmp=tempfile.mkstemp(dir=folder)
 with os.fdopen(fd,'wb') as f: f.write(unit.read_bytes());f.flush();os.fsync(f.fileno())
 os.chmod(tmp,0o644);os.replace(tmp,target)
 subprocess.run(['systemctl','daemon-reload'],check=True)
except Exception:
 if previous: shutil.copy2(backup/'50-reviewed-source.conf',target)
 elif target.exists(): target.unlink()
 subprocess.run(['systemctl','daemon-reload'],check=True)
 raise
print('Public-data override backup: '+str(backup))
PY
printf 'Public-data timer pinned to %s; no timer was armed.\n' "$commit"
