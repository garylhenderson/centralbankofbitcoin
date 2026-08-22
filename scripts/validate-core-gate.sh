#!/usr/bin/env bash
# Validate run-tests.sh's "Core is really here" gate in BOTH directions.
#
# ⚠️ ROUND 14 FOUND THIS FILE BROKEN IN TWO WAYS, AND IT HAD NEVER BEEN AUDITED
# IN THIRTEEN ROUNDS. It is the script that certifies the gate that certifies the
# test environment that certifies everything else.
#
#   1. IT COULD NOT FAIL. There was no `set -e`, and every arm's result was an
#      `echo` — including `!!! FALSE PASS — gate is useless`. The last line was
#      `kill_v`, which succeeds, so the script printed that a gate was useless and
#      EXITED 0. Anyone running it in CI, or reading the exit code, was told a
#      broken Core gate had been validated.
#   2. IT VALIDATED THE WRONG DIRECTORY. `CACHE` was hardcoded to
#      `/tmp/cbob-vault-test` while `run-tests.sh` reads
#      `${CBOB_CACHE:-/opt/cbob-vaults/.cache}` — and run-tests.sh's own comment
#      says WHY it moved: "NOT /tmp: it is world-writable, and this directory
#      holds the Core binary every gate below compares against." So this script
#      proved a gate over bytes the real gate never reads, in the exact directory
#      the real gate was moved away from.
#
# It now shares the default with run-tests.sh, and every arm EXITS NON-ZERO when
# it gets the wrong answer. A validation that cannot fail is not a validation.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
CACHE="${CBOB_CACHE:-/opt/cbob-vaults/.cache}"
CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
RPC=http://127.0.0.1:8999
die(){ echo "FATAL: $*" >&2; exit 1; }
[ -s "$CACHE/core-mainnet.so" ] || die "$CACHE/core-mainnet.so is missing — run scripts/run-tests.sh first, which fetches and pins it"

kill_v(){ pkill -x solana-test-val 2>/dev/null||true; fuser -k -TERM 8999/tcp 9900/tcp 2>/dev/null||true; sleep 3; }
gate(){ # the EXACT logic from run-tests.sh
  solana -u "$RPC" program dump "$CORE" "$CACHE/g-onchain.so" >/dev/null 2>&1 || { echo "  GATE FIRED: Core not present"; return 1; }
  cmp -s "$CACHE/g-onchain.so" "$1" || { echo "  GATE FIRED: Core differs from expected"; return 1; }
  echo "  GATE PASSED"; return 0; }
# `set -e` must NOT kill us on the expected-failure arms, so the verdict is taken
# from an explicit branch rather than from the exit status leaking upward.
must_fire(){ if gate "$1"; then die "FALSE PASS — the gate accepted $2. The gate is useless."; fi; echo "  correct: fired"; }
must_pass(){ if ! gate "$1"; then die "FALSE FAIL — the gate rejected $2. It would reject every good validator."; fi; echo "  correct: passed"; }
boot(){ rm -rf "$CACHE/g-ledger"; solana-test-validator --quiet --reset --ledger "$CACHE/g-ledger" --rpc-port 8999 \
    --deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g \
    --deactivate-feature TestFeature11111111111111111111111111111111 "$@" &
  for i in $(seq 1 90); do solana -u "$RPC" cluster-version >/dev/null 2>&1 && return 0; sleep 1; done
  die "validator never came up"; }

echo "── ARM 1: validator WITHOUT Core (gate MUST fire) ──"
kill_v; boot; must_fire "$CACHE/core-mainnet.so" "a validator with no Core on it"

echo; echo "── ARM 2: validator WITH real Core, expected bytes tampered (gate MUST fire) ──"
kill_v; boot --bpf-program "$CORE" "$CACHE/core-mainnet.so"
cp "$CACHE/core-mainnet.so" "$CACHE/g-tampered.so"
printf '\xff' | dd of="$CACHE/g-tampered.so" bs=1 seek=5000 conv=notrunc 2>/dev/null
must_fire "$CACHE/g-tampered.so" "a Core that differs from the pinned bytes"

echo; echo "── ARM 3: validator WITH real Core, untampered (gate MUST pass) ──"
must_pass "$CACHE/core-mainnet.so" "the genuine pinned mainnet Core"
kill_v
rm -f "$CACHE/g-tampered.so" "$CACHE/g-onchain.so"
echo; echo "core gate validated in BOTH directions: fires on absent Core, fires on tampered bytes, passes on the real thing"
