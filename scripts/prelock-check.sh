#!/usr/bin/env bash
# R1 certification preparation. No signing, authority change, cron or notification.
set -euo pipefail
cd /opt/cbob-vaults
[[ ( "${1:-}" = --run || "${1:-}" = --rehearse ) && "${2:-}" = --commit && "${3:-}" =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage: prelock-check.sh --run|--rehearse --commit <reviewed-sha>'; exit 2; }
umask 077
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'Commit and review source first.' >&2; exit 1; }
commit=$(git rev-parse HEAD)
git fetch -q origin v6
[ "$commit" = "$3" ] && [ "$commit" = "$(git rev-parse origin/v6)" ] || { echo "Reviewed SHA, HEAD and fetched origin/v6 must agree." >&2; exit 1; }
deadline=$(node --input-type=module -e 'import {RULED_DATES} from "./scripts/check-launch-params.mjs";console.log(RULED_DATES.lock_deadline)')
now=$(date +%s)
[ "$1" = --rehearse ] || (( now >= deadline - 86400 && now < deadline )) || { echo 'Outside the R1 certification window. No suite started and no lock authorized.' >&2; exit 1; }
# Fail before expensive tests if the reviewed root helper is not installed.
[ -f /usr/local/sbin/cbob-seal-prelock ] && cmp -s scripts/seal-prelock.py /usr/local/sbin/cbob-seal-prelock || { echo 'Install the reviewed root sealer first.' >&2; exit 1; }
[ -x /usr/local/sbin/cbob-seal-prelock ] && [ "$(stat -c '%u:%g %a' /usr/local/sbin/cbob-seal-prelock)" = '0:0 755' ] || { echo 'Root sealer ownership/mode must be root:root 0755.' >&2; exit 1; }
sudo -n true || { echo 'Noninteractive archive permission is unavailable.' >&2; exit 1; }
source scripts/validator-lock.sh
validator_lock prelock-certification || exit 1
base=.cache/prelock; mode=certification
if [ "$1" = --rehearse ]; then base=.cache/prelock-rehearse; mode=rehearsal; fi
mkdir -p "$base"
receipt=$(mktemp -d "$base/run-XXXXXXXX")
printf '%s\n' "$mode" > "$receipt/mode"
printf '%s\n' "$commit" > "$receipt/commit"
printf '%s\n' "$now" > "$receipt/started"
echo "Evidence directory: $receipt"
node scripts/prelock-core.mjs > "$receipt/core-before.json"
# No generated diagnostic runner, bypass or environment-selected Core pin.
export CBOB_SHIP_GATE=1
run_certified() {
  local name=$1; shift
  local rc=0
  "$@" > "$receipt/$name.log" 2>&1 || rc=$?
  printf '%s\n' "$rc" > "$receipt/$name.status"
  [ "$rc" = 0 ] || { echo "$name failed; no receipt and no lock." >&2; exit "$rc"; }
}
run_certified full-suite bash scripts/run-tests.sh
run_certified simulation bash sim/run-sim.sh
run_certified holder-e2e bash web/test/e2e-localnet.sh
node scripts/prelock-core.mjs > "$receipt/core-after.json"
node scripts/prelock-receipt.mjs --seal "$receipt"
if [ "$mode" = rehearsal ]; then echo 'Full rehearsal, archive and verification completed. This cannot authorize a lock.'
else echo 'Test receipt prepared. Re-verify it immediately before the separate owner-authorized lock.'; fi
