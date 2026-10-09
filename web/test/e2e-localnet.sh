#!/usr/bin/env bash
# THE PAGES, END TO END, ON A LOCAL VALIDATOR. Prepares the validator exactly as
# sim/run-sim.sh does (steps 1-4: pinned mainnet Core, the three real reserve mints
# and two real Proof of Burn assets cloned from mainnet, the LOCALNET build of the
# five programs deployed upgradeable), then runs web/test/e2e-localnet.mjs.
#
# It uses the suite's ports (8999/9900) and REFUSES to start while anything holds
# them or while scripts/run-tests.sh or sim/run-sim.sh is running. It never kills a
# validator it did not start. Like run-sim.sh it rebuilds target/deploy with
# --features localnet; run scripts/build-mainnet.sh again before any mainnet step.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT=/opt/cbob-vaults
CACHE="$ROOT/.cache"; LEDGER="$CACHE/web-e2e-ledger"; FIX="$ROOT/sim/.fixtures"
CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
CORE_SHA256_EXPECTED=30dce56b6b70ea524a3882ef7bc73936b9ae6ff3c3ea5cfee709ea935e710bf2
# ROUND 47: Phantom's guard program, so the Phantom-like signer's Lighthouse checks RUN
# (they are not stubs). PINNED 2026-10-09 from a `solana program dump` off mainnet.
LIGHTHOUSE=L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95
LIGHTHOUSE_SHA256_EXPECTED=a89179ae024ac36aa5fc308251caa84cd0a3390ae66d8523514004a86d5148bb
SIMD_0500=B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g
SIMD_0161=TestFeature11111111111111111111111111111111
RPC=http://127.0.0.1:8999
PROGS="cbob_vaults cbob_vault_mint cbob_vault_burn cbob_vault_gov cbob_vault_sweep"
die(){ echo "FATAL: $*" >&2; exit 1; }
pgrep -f "scripts/run-tests.sh" >/dev/null && die "scripts/run-tests.sh is running; it owns the validator ports"
pgrep -f "sim/run-sim.sh" >/dev/null && die "sim/run-sim.sh is running; it owns the validator ports"
ss -ltn 2>/dev/null | grep -qE ':(8999|9900)\b' && die "ports 8999/9900 are in use; this script will not kill what holds them"
source "$ROOT/scripts/token-programs.sh"
token_programs_prepare "$CACHE" || die "mainnet token-program pins failed"
VPID=""
cleanup(){ [ -n "$VPID" ] && kill "$VPID" 2>/dev/null || true; }
trap cleanup EXIT

echo "[1/5] Core"
[ "$(sha256sum "$CACHE/core-mainnet.so" | cut -d' ' -f1)" = "$CORE_SHA256_EXPECTED" ] || die "the cached Core is not the pinned mainnet build; run scripts/run-tests.sh first"
[ -s "$CACHE/lighthouse-mainnet.so" ] || solana program dump -u "${MRPC:-https://api.mainnet-beta.solana.com}" "$LIGHTHOUSE" "$CACHE/lighthouse-mainnet.so" >/dev/null
[ "$(sha256sum "$CACHE/lighthouse-mainnet.so" | cut -d' ' -f1)" = "$LIGHTHOUSE_SHA256_EXPECTED" ] || die "the cached Lighthouse is not the pinned mainnet build"
echo "[2/5] fixtures off mainnet"
cd "$ROOT"
node sim/fixtures.mjs || die "mint fixtures"
node sim/clone-pob.mjs || die "Proof of Burn fixtures"
echo "[3/5] build (localnet)"
cargo-build-sbf --arch v3 --features localnet 2>&1 | grep -viE "^\s*(Compiling|Checking|warning)" | tail -2
for f in $PROGS; do cp -f "$ROOT/target/sbpfv3-solana-solana/release/$f.so" "$ROOT/target/deploy/$f.so"; done
echo "[4/5] fresh validator"
rm -rf "$LEDGER"
ACCTS=()
for f in "$FIX"/*.json; do
  case "$(basename "$f")" in mint-authority.json|pob-owner.json|pob-picks.json) continue;; esac
  ACCTS+=(--account "$(basename "$f" .json)" "$f")
done
solana-test-validator --quiet --reset --ledger "$LEDGER" --rpc-port 8999 \
  --deactivate-feature "$SIMD_0500" --deactivate-feature "$SIMD_0161" \
  --bpf-program "$CORE" "$CACHE/core-mainnet.so" --bpf-program "$LIGHTHOUSE" "$CACHE/lighthouse-mainnet.so" "${TOKEN_PROGRAM_ARGS[@]}" "${ACCTS[@]}" &
VPID=$!
for i in $(seq 1 90); do solana -u "$RPC" cluster-version >/dev/null 2>&1 && break
  kill -0 $VPID 2>/dev/null || die "validator died"; sleep 1; done
token_programs_verify "$CACHE" "$RPC" || die "validator token-program bytes differ"
UA="$CACHE/web-e2e-upgrade-authority.json"
[ -s "$UA" ] || solana-keygen new --no-bip39-passphrase -s -o "$UA" >/dev/null
solana -u "$RPC" airdrop 500 "$(solana-keygen pubkey "$UA")" >/dev/null
for f in $PROGS; do
  solana -u "$RPC" program deploy "$ROOT/target/deploy/$f.so" --program-id "$ROOT/target/deploy/$f-keypair.json" \
    --keypair "$UA" --upgrade-authority "$UA" >/dev/null || die "deploy $f"
done
echo "[5/5] the pages' library, end to end"
# ROUND 42 (C26): an exact external floor. An exit code cannot tell "all passed"
# from "stopped early and passed what it reached", so the count must EQUAL it.
E2E_FLOOR=152
E2E_RC=0; E2E_OUT=$(CBOB_E2E_RPC="$RPC" node "$ROOT/web/test/e2e-localnet.mjs" 2>&1) || E2E_RC=$?
echo "$E2E_OUT"
[ "$E2E_RC" -eq 0 ] || die "the end-to-end test failed (exit $E2E_RC)"
grep -qE "^e2e-localnet: ${E2E_FLOOR}/${E2E_FLOOR} passed\s*$" <<<"$E2E_OUT" || die "the end-to-end count is not exactly ${E2E_FLOOR}/${E2E_FLOOR} (move E2E_FLOOR with the arms)"
echo "  e2e ${E2E_FLOOR}/${E2E_FLOOR}, floor ${E2E_FLOOR}"
