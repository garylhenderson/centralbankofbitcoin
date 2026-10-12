#!/usr/bin/env bash
# Build an isolated candidate; install only a separately committed reviewed attestation.
set -euo pipefail
cd /opt/cbob-vaults
[[ ( "${1:-}" = --build || "${1:-}" = --install ) && "${2:-}" =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage: prepare-ceremony.sh --build|--install <source-commit>'; exit 2; }
commit=$2
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'Commit reviewed source first.' >&2; exit 1; }
git fetch -q origin v6
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/v6)" ] || { echo 'Use the pushed reviewed tip.' >&2; exit 1; }
git merge-base --is-ancestor "$commit" HEAD
candidate="$(realpath /opt/cbob-vaults/.cache)/ceremony-artifacts/$commit"
if [ "$1" = --install ]; then
  [[ "${3:-}" =~ ^[a-f0-9]{40}$ && "${4:-}" =~ ^[a-f0-9]{64}$ ]] || { echo 'Install also requires the independently reviewed attestation commit and digest.' >&2; exit 1; }
  [ "$(stat -c '%u:%g %a' /usr/local/sbin/cbob-install-ceremony)" = '0:0 755' ] && cmp -s web/deploy/install-ceremony.py /usr/local/sbin/cbob-install-ceremony || { echo 'Installed ceremony installer differs from reviewed source.' >&2; exit 1; }
  sudo -n /usr/local/sbin/cbob-install-ceremony "$candidate" "$3" "$commit" "$4"
  exit
fi
[ "$(git rev-parse HEAD)" = "$commit" ] || { echo 'Build the exact reviewed source tip.' >&2; exit 1; }
[ ! -e "$candidate" ] || { echo 'Candidate exists; retain it and use a new reviewed commit.' >&2; exit 1; }
# The same path-independent builder is used by the independent operator.
# No parent Node/Python loader or module-search environment is inherited.
env -i PATH=/usr/bin:/bin /usr/bin/node web/deploy/rebuild-ceremony.mjs "/opt/cbob-vaults" "${CBOB_BUILD_DEPS:?Supply the frozen dependency directory}" "/opt/cbob-vaults/dist" "$candidate"
