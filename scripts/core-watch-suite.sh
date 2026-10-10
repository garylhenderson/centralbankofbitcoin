#!/usr/bin/env bash
# Started by scripts/core-watch.mjs when Metaplex Core on mainnet stops matching
# the pin. Runs the WHOLE on-chain suite against the new Core bytes, writes the
# result to .cache/core-watch/suite-<hash>.json, and the next watch tick emails it.
#
# DIAGNOSTIC, never certifying: it runs a generated copy of run-tests.sh with two
# lines changed (the pinned hash, and the mainnet probe, which would otherwise
# refuse exactly the mismatch being measured). A re-pin is still a commit.
#
# It shares .cache with every other suite run (run-tests.sh refuses any other
# cache), so it swaps .cache/core-mainnet.so ONLY while holding the validator
# lock, and puts the pinned bytes back on every exit path.
set -uo pipefail
H="${1:?usage: core-watch-suite.sh <sha256 of the new Core bytes>}"
[[ "$H" =~ ^[0-9a-f]{64}$ ]] || { echo "not a sha256: $H"; exit 2; }
ROOT=/opt/cbob-vaults; C=$ROOT/.cache; D=$C/core-watch; L=$C/VALIDATOR.lock
OUT=$D/suite-$H.json; LOGF=$D/suite-$H.log; RUNNER=$D/runner-$H.sh; BACK=$D/pinned-core.so
NEW=$D/core-$H.so
res(){ printf '{"status":"%s","rc":%s,"summary":"%s","log":"%s","at":"%s"}\n' "$1" "$2" "$3" "$LOGF" "$(date -u +%FT%TZ)" > "$OUT"; }
[ -s "$NEW" ] && [ "$(sha256sum "$NEW" | cut -d' ' -f1)" = "$H" ] || { res done 3 "saved Core bytes missing or do not hash to $H"; exit 3; }
( set -o noclobber; echo $$ > "$D/running-$H" ) 2>/dev/null || { echo "already running for $H"; exit 0; }
res waiting null "waiting for the test validator"

# wait for the validator (never two), at most 12 hours
for i in $(seq 1 1440); do
  if [ ! -e "$L" ] && ! pgrep -x solana-test-val >/dev/null && ( set -o noclobber; echo "core-watch $H $(date -u +%FT%TZ)" > "$L" ) 2>/dev/null; then GOT=1; break; fi
  sleep 30
done
[ "${GOT:-0}" = 1 ] || { res done 4 "the test validator stayed busy for 12 hours; nothing ran"; rm -f "$D/running-$H"; exit 4; }

PIN=$(grep -oE '^CORE_SHA256_EXPECTED=[0-9a-f]{64}$' $ROOT/scripts/run-tests.sh | cut -d= -f2)
SWAPPED=0
restore(){
  # only ever puts back bytes this run took out, and only if they are the pin
  if [ "$SWAPPED" = 1 ] && [ "$(sha256sum "$BACK" | cut -d' ' -f1)" = "$PIN" ]; then cp "$BACK" "$C/core-mainnet.so"; fi
  rm -f "$L" "$D/running-$H" "$RUNNER"
}
trap restore EXIT
trap 'exit 130' INT TERM

# keep the pinned bytes; refuse to touch a cache that is not the pinned Core
[ "$(sha256sum "$C/core-mainnet.so" | cut -d' ' -f1)" = "$PIN" ] || { res done 5 ".cache/core-mainnet.so is not the pinned Core; refused to swap it"; exit 5; }
cp "$C/core-mainnet.so" "$BACK"

# the generated runner: exactly two lines differ from run-tests.sh, and that is checked
PROBE='  MAIN_RC=0; MAIN_OUT=$(node scripts/probe-mainnet-facts.mjs) || MAIN_RC=$?'
[ "$(grep -cxF "$PROBE" $ROOT/scripts/run-tests.sh)" = 1 ] || { res done 6 "run-tests.sh changed shape (probe line); runner not generated"; exit 6; }
sed -e "s/^CORE_SHA256_EXPECTED=$PIN\$/CORE_SHA256_EXPECTED=$H/" \
    -e "s|^  MAIN_RC=0; MAIN_OUT=\$(node scripts/probe-mainnet-facts.mjs) \|\| MAIN_RC=\$?\$|  MAIN_RC=0; MAIN_OUT='35/35 as predicted (CORE-WATCH DIAGNOSTIC: probe bypassed while a new Core is measured)'|" \
    $ROOT/scripts/run-tests.sh > "$RUNNER"
[ "$(diff $ROOT/scripts/run-tests.sh "$RUNNER" | grep -c '^>')" = 2 ] || { res done 6 "generated runner differs from run-tests.sh by other than the two expected lines"; exit 6; }
SWAPPED=1; cp "$NEW" "$C/core-mainnet.so"

res running null "suite running against the new Core"
cd $ROOT && bash "$RUNNER" > "$LOGF" 2>&1; RC=$?
SUM=$(grep -oE '[0-9]+/[0-9]+ (on-chain )?(assertions )?as predicted|[0-9]+/[0-9]+ passed' "$LOGF" | tail -3 | paste -sd';' | tr -d '"')
FAILS=$(grep -c '^  XX' $C/suite.log 2>/dev/null || echo 0)
res done "$RC" "${SUM:-no summary line}; ${FAILS} failing assertions"
exit "$RC"
