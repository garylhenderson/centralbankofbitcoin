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
# lock (scripts/validator-lock.sh, the kernel lease every runner takes since
# round 47, V47o-2), and puts the pinned bytes back on every exit path it can.
# A SIGKILL, OOM or reboot skips the trap: the cache is then off the pin, which
# every runner refuses at its pin check, and the next diagnostic puts the kept
# pinned bytes back before it starts.
set -uo pipefail
H="${1:?usage: core-watch-suite.sh <sha256 of the new Core bytes>}"
[[ "$H" =~ ^[0-9a-f]{64}$ ]] || { echo "not a sha256: $H"; exit 2; }
ROOT=/opt/cbob-vaults; C=$ROOT/.cache; D=$C/core-watch
OUT=$D/suite-$H.json; LOGF=$D/suite-$H.log; RUNNER=$D/runner-$H.sh; BACK=$D/pinned-core.so
NEW=$D/core-$H.so
# the result as JSON built by JSON.stringify (round 47, V47o-1: printf embedded a
# raw newline from the failure count, so a PASS was unreadable and never reported)
# Round 48 (V48o-1): every result carries this run's pid and the boot it ran in, so a run
# killed outside its trap (SIGKILL, out of memory, a reboot) reads as DIED, not as forever
# "waiting" or "running"; the same pair in the marker lets a later start replace a dead one.
BOOT=$(cat /proc/sys/kernel/random/boot_id)
res(){ node -e 'const [st, rc, sum, log, pid, boot] = process.argv.slice(1); process.stdout.write(JSON.stringify({ status: st, rc: rc === "null" ? null : Number(rc), summary: sum, log, pid: Number(pid), boot, at: new Date().toISOString() }) + "\n")' "$1" "$2" "$3" "$LOGF" "$$" "$BOOT" > "$OUT.tmp" && mv -f "$OUT.tmp" "$OUT"; }
[ -s "$NEW" ] && [ "$(sha256sum "$NEW" | cut -d' ' -f1)" = "$H" ] || { res done 3 "saved Core bytes missing or do not hash to $H"; exit 3; }
mark(){ ( set -o noclobber; echo "$$ $BOOT" > "$D/running-$H" ) 2>/dev/null; }
if ! mark; then
  # a marker whose run is gone (another boot, or a dead pid) is stale: replace it once
  read -r MPID MBOOT < "$D/running-$H" 2>/dev/null || true
  if [ "${MBOOT:-}" != "$BOOT" ] || ! kill -0 "${MPID:-0}" 2>/dev/null; then
    rm -f "$D/running-$H"; mark || { echo "already running for $H"; exit 0; }
  else echo "already running for $H (pid $MPID)"; exit 0; fi
fi
res waiting null "waiting for the test validator"

# wait for the validator (never two), at most 12 hours: the same kernel lease every
# runner takes; the generated runner below inherits fd 9 and so may take it again
exec 9>>"$C/VALIDATOR.flock"
flock -w 43200 9 || { res done 4 "the test validator stayed busy for 12 hours; nothing ran"; rm -f "$D/running-$H"; exit 4; }
echo "core-watch $H pid $$ since $(date -u +%FT%TZ)" > "$C/VALIDATOR.flock.holder"

PIN=$(grep -oE '^CORE_SHA256_EXPECTED=[0-9a-f]{64}$' $ROOT/scripts/run-tests.sh | cut -d= -f2)
SWAPPED=0
restore(){
  # only ever puts back bytes this run took out, and only if they are the pin
  if [ "$SWAPPED" = 1 ] && [ "$(sha256sum "$BACK" | cut -d' ' -f1)" = "$PIN" ]; then cp "$BACK" "$C/core-mainnet.so"; fi
  rm -f "$D/running-$H" "$RUNNER"
}
trap restore EXIT
trap 'exit 130' INT TERM

# a diagnostic that died without its trap left the new bytes in the cache: put the
# pinned bytes it kept back first (only ever bytes that hash to the pin)
if [ "$(sha256sum "$C/core-mainnet.so" | cut -d' ' -f1)" != "$PIN" ] && [ -s "$BACK" ] && [ "$(sha256sum "$BACK" | cut -d' ' -f1)" = "$PIN" ]; then
  cp "$BACK" "$C/core-mainnet.so"; echo "restored the pinned Core a crashed diagnostic left swapped" >> "$LOGF"
fi
# keep the pinned bytes; refuse to touch a cache that is not the pinned Core
[ "$(sha256sum "$C/core-mainnet.so" | cut -d' ' -f1)" = "$PIN" ] || { res done 5 ".cache/core-mainnet.so is not the pinned Core; refused to swap it"; exit 5; }
cp "$C/core-mainnet.so" "$BACK"

# the generated runner: exactly two lines differ from run-tests.sh, and that is checked
PROBE='  MAIN_RC=0; MAIN_OUT=$(node scripts/probe-mainnet-facts.mjs) || MAIN_RC=$?'
# the probe's floor, read from the runner rather than typed here (round 47, C19)
MF=$(grep -oE '^MAINNET_FLOOR=[0-9]+$' $ROOT/scripts/run-tests.sh | cut -d= -f2)
[ -n "$MF" ] || { res done 6 "run-tests.sh has no MAINNET_FLOOR; runner not generated"; exit 6; }
[ "$(grep -cxF "$PROBE" $ROOT/scripts/run-tests.sh)" = 1 ] || { res done 6 "run-tests.sh changed shape (probe line); runner not generated"; exit 6; }
sed -e "s/^CORE_SHA256_EXPECTED=$PIN\$/CORE_SHA256_EXPECTED=$H/" \
    -e "s|^  MAIN_RC=0; MAIN_OUT=\$(node scripts/probe-mainnet-facts.mjs) \|\| MAIN_RC=\$?\$|  MAIN_RC=0; MAIN_OUT='$MF/$MF as predicted (CORE-WATCH DIAGNOSTIC: probe bypassed while a new Core is measured)'|" \
    $ROOT/scripts/run-tests.sh > "$RUNNER"
[ "$(diff $ROOT/scripts/run-tests.sh "$RUNNER" | grep -c '^>')" = 2 ] || { res done 6 "generated runner differs from run-tests.sh by other than the two expected lines"; exit 6; }
SWAPPED=1; cp "$NEW" "$C/core-mainnet.so"

res running null "suite running against the new Core"
cd $ROOT && bash "$RUNNER" > "$LOGF" 2>&1; RC=$?
SUM=$(grep -oE '[0-9]+/[0-9]+ (on-chain )?(assertions )?as predicted|[0-9]+/[0-9]+ passed' "$LOGF" | tail -3 | paste -sd';' | tr -d '"')
# counted in THIS run's own log (round 48, V48o-5: the shared .cache/suite.log can hold an
# earlier run's count when this one died before the on-chain step)
FAILS=$(grep -c '^  XX' "$LOGF" 2>/dev/null || true); FAILS=${FAILS:-0}
res done "$RC" "${SUM:-no summary line}; ${FAILS} failing assertions"
exit "$RC"
