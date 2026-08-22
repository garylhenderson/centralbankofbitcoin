#!/usr/bin/env bash
# Validate run-tests.sh's "Core is really here" gate in BOTH directions.
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
CACHE=/tmp/cbob-vault-test; CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
RPC=http://127.0.0.1:8999
kill_v(){ pkill -x solana-test-val 2>/dev/null||true; fuser -k -TERM 8999/tcp 9900/tcp 2>/dev/null||true; sleep 3; }
gate(){ # the EXACT logic from run-tests.sh
  solana -u "$RPC" program dump "$CORE" "$CACHE/g-onchain.so" >/dev/null 2>&1 || { echo "GATE FIRED: Core not present"; return 1; }
  cmp -s "$CACHE/g-onchain.so" "$1" || { echo "GATE FIRED: Core differs from expected"; return 1; }
  echo "GATE PASSED"; return 0; }
boot(){ rm -rf "$CACHE/g-ledger"; solana-test-validator --quiet --reset --ledger "$CACHE/g-ledger" --rpc-port 8999 \
    --deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g \
    --deactivate-feature TestFeature11111111111111111111111111111111 "$@" & 
  for i in $(seq 1 90); do solana -u "$RPC" cluster-version >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

echo "── ARM 1: validator WITHOUT Core (gate MUST fire) ──"
kill_v; boot; gate "$CACHE/core-mainnet.so" && echo "!!! FALSE PASS — gate is useless" || echo "correct"

echo; echo "── ARM 2: validator WITH real Core, but expected bytes tampered (gate MUST fire) ──"
kill_v; boot --bpf-program "$CORE" "$CACHE/core-mainnet.so"
cp "$CACHE/core-mainnet.so" "$CACHE/g-tampered.so"
printf '\xff' | dd of="$CACHE/g-tampered.so" bs=1 seek=5000 conv=notrunc 2>/dev/null
gate "$CACHE/g-tampered.so" && echo "!!! FALSE PASS — gate is useless" || echo "correct"

echo; echo "── ARM 3: validator WITH real Core, untampered (gate MUST pass) ──"
gate "$CACHE/core-mainnet.so" && echo "correct" || echo "!!! FALSE FAIL — gate rejects a good validator"
kill_v
