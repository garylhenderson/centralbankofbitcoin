#!/usr/bin/env bash
# R1 certification preparation. No signing, authority change, cron or notification.
set -euo pipefail
cd /opt/cbob-vaults
[[ "${1:-}" = --run ]] || { echo 'Usage: prelock-check.sh --run (only in the 24 hours before the ruled lock)'; exit 2; }
umask 077
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'Commit and review source first.' >&2; exit 1; }
commit=$(git rev-parse HEAD)
git merge-base --is-ancestor "$commit" origin/v6
deadline=$(node --input-type=module -e 'import {RULED_DATES} from "./scripts/check-launch-params.mjs";console.log(RULED_DATES.lock_deadline)')
now=$(date +%s)
(( now >= deadline - 86400 && now < deadline )) || { echo 'Outside the R1 certification window. No suite started and no lock authorized.' >&2; exit 1; }
source scripts/validator-lock.sh
validator_lock prelock-certification || exit 1
mkdir -p .cache/prelock
receipt=$(mktemp -d .cache/prelock/run-XXXXXXXX)
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
echo 'Test receipt prepared. Re-verify it immediately before the separate owner-authorized lock.'
