#!/usr/bin/env bash
# THE DRESS-REHEARSAL DRIVER, END TO END, ON A LOCAL VALIDATOR (road step 8's
# proof before any SOL leaves the box). Run INSIDE a recorded rehearsal tree.
#
# Boots a validator the way web/test/e2e-localnet.sh does (the pinned mainnet
# Core, the pinned token programs, the three real reserve mints copied with a
# LOCAL mint authority by sim/fixtures.mjs) but deploys nothing itself: the
# driver deploys the five programs at the tree's throwaway ids, as it will on
# mainnet. The revenue cycle (item 22.3/22.4) needs the real pools and Pyth and
# is reported NOT-RUN-HERE; DAS (22.5) likewise.
#
# It refuses while anything holds the suite's ports or another validator job
# runs, and never kills a validator it did not start.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT=/opt/cbob-vaults
CACHE="$ROOT/.cache"; LEDGER="$CACHE/rehearsal-local-ledger"; FIX="$ROOT/sim/.fixtures"
CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
SIMD_0500=B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g
SIMD_0161=TestFeature11111111111111111111111111111111
RPC=http://127.0.0.1:8999
STATE="${1:-$ROOT/.rehearsal-run/local-state.json}"
die(){ echo "FATAL: $*" >&2; exit 1; }
source "$ROOT/scripts/validator-lock.sh"   # one validator at a time, before the exit trap (round 48, V48-2)
validator_lock rehearsal-local || exit 1
[ -e "$ROOT/REHEARSAL-RECORD.txt" ] || die "not a recorded rehearsal tree"
pgrep -f "scripts/run-tests.sh|sim/run-sim.sh|web/test/e2e-localnet.sh" >/dev/null && die "another validator job is running"
ss -ltn 2>/dev/null | grep -qE ':(8997|8998|8999|9900)\b' && die "ports 8997-8999/9900 are in use; this script will not kill what holds them"
PIN=$(sed -n 's/^CORE_SHA256_EXPECTED=\([0-9a-f]\{64\}\)$/\1/p' "$ROOT/scripts/run-tests.sh")
[ "$(sha256sum "$CACHE/core-mainnet.so" | cut -d' ' -f1)" = "$PIN" ] || die "the cached Core is not the pinned mainnet build"
source "$ROOT/scripts/token-programs.sh"
token_programs_prepare "$CACHE" || die "mainnet token-program pins failed"
VPID=""; SPID=""
cleanup(){ [ -n "$SPID" ] && kill "$SPID" 2>/dev/null || true; [ -n "$VPID" ] && kill "$VPID" 2>/dev/null || true; }
trap cleanup EXIT
cd "$ROOT"
node sim/fixtures.mjs >/dev/null || die "mint fixtures"
rm -rf "$LEDGER"
ACCTS=()
for f in "$FIX"/*.json; do
  case "$(basename "$f")" in mint-authority.json|pob-owner.json|pob-picks.json) continue;; esac
  ACCTS+=(--account "$(basename "$f" .json)" "$f")
done
solana-test-validator --quiet --reset --ledger "$LEDGER" --rpc-port 8999 \
  --deactivate-feature "$SIMD_0500" --deactivate-feature "$SIMD_0161" \
  --bpf-program "$CORE" "$CACHE/core-mainnet.so" "${TOKEN_PROGRAM_ARGS[@]}" "${ACCTS[@]}" 9>&- &   # the validator never holds the lock (V47o-2)
VPID=$!
for i in $(seq 1 90); do solana -u "$RPC" cluster-version >/dev/null 2>&1 && break
  kill -0 $VPID 2>/dev/null || die "validator died"; sleep 1; done
token_programs_verify "$CACHE" "$RPC" || die "validator token-program bytes differ"
# the jobs reach the validator through a LOCAL-ONLY stand-in for DAS (the alarm lists vaults by DAS)
node "$ROOT/sim/das-shim.mjs" 8997 8999 & SPID=$!
for i in $(seq 1 20); do ss -ltn 2>/dev/null | grep -qE ':8997\b' && break; sleep 0.5; done
# ROUND 46: CBOB_LOCAL_CEREMONY=page proves the MAINNET path locally: the programs are
# deployed with the SHIPPING build and UPGRADED to the localnet one (upgrade-1..5), and
# road step 10 is signed by sim/rehearsal-ceremony-helper.mjs standing in for Gary while
# the driver only waits and reads back (it never signs a ceremony step in page mode).
MODE="${CBOB_LOCAL_CEREMONY:-box}"
EXTRA=(); HPID=""
if [ "$MODE" = page ]; then
  EXTRA=(--ceremony page --deploy-build shipping)
  mkdir -p "$ROOT/.rehearsal-run"; chmod 700 "$ROOT/.rehearsal-run"
  node "$ROOT/sim/rehearsal-ceremony-helper.mjs" --rpc "$RPC" --state "$STATE" > "$ROOT/.rehearsal-run/ceremony-helper.log" 2>&1 & HPID=$!
  trap 'cleanup; [ -n "$HPID" ] && kill "$HPID" 2>/dev/null || true' EXIT
fi
node "$ROOT/scripts/rehearsal-run.mjs" --local --rpc "$RPC" --state "$STATE" --max-sol 500 --jobs-rpc http://127.0.0.1:8997 "${EXTRA[@]}" --execute
