#!/usr/bin/env bash
# THE TEST VAULT SIMULATION RUNNER. See sim/test-vault.ts for what it proves.
#
# It boots its OWN fresh validator on the suite's ports, so it must never run at
# the same time as scripts/run-tests.sh (each kills the other's validator). It
# refuses to start while one is running.
#
# What is real here, and how it got here:
#   * Metaplex Core: the cached mainnet dump scripts/run-tests.sh pins by sha256
#     (checked again below, never re-downloaded here).
#   * cbBTC, $GARY, $GIRAFFISH: mainnet mint accounts, mint authority patched
#     (sim/fixtures.mjs asserts nothing else changed).
#   * The Giraffish Moments collection and two Proof of Burn assets: mainnet
#     accounts, the PoB owner patched (sim/clone-pob.mjs asserts nothing else).
#   * Our five programs: the SAME localnet build the suite certifies, rebuilt here.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT=/opt/cbob-vaults
CACHE="$ROOT/.cache"; LEDGER="$CACHE/sim-ledger"; FIX="$ROOT/sim/.fixtures"
CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
CORE_SHA256_EXPECTED=30dce56b6b70ea524a3882ef7bc73936b9ae6ff3c3ea5cfee709ea935e710bf2
SIMD_0500=B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g
SIMD_0161=TestFeature11111111111111111111111111111111
RPC=http://127.0.0.1:8999
PROGS="cbob_vaults cbob_vault_mint cbob_vault_burn cbob_vault_gov cbob_vault_sweep"
die(){ echo "FATAL: $*" >&2; exit 1; }
source "$ROOT/scripts/token-programs.sh"
token_programs_prepare "$CACHE" || die "mainnet token-program pins failed"
pgrep -f "scripts/run-tests.sh" >/dev/null && die "scripts/run-tests.sh is running; it owns the validator ports. Run this after it."
cleanup(){ pkill -x solana-test-val 2>/dev/null || true; fuser -k -TERM 8999/tcp 9900/tcp 2>/dev/null || true; }
trap cleanup EXIT

echo "[1/5] Core"
[ "$(sha256sum "$CACHE/core-mainnet.so" | cut -d' ' -f1)" = "$CORE_SHA256_EXPECTED" ] \
  || die "the cached Core is not the pinned mainnet build; run scripts/run-tests.sh first"

echo "[2/5] fixtures off mainnet"
cd "$ROOT"
node sim/fixtures.mjs || die "mint fixtures"
node sim/clone-pob.mjs || die "Proof of Burn fixtures"

echo "[3/5] build (localnet, the build the suite certifies)"
cargo-build-sbf --arch v3 --features localnet 2>&1 | grep -viE "^\s*(Compiling|Checking|warning)" | tail -2
for f in $PROGS; do cp -f "$ROOT/target/sbpfv3-solana-solana/release/$f.so" "$ROOT/target/deploy/$f.so"; done

echo "[4/5] fresh validator with the real accounts"
cleanup
for i in $(seq 1 30); do ss -ltn 2>/dev/null | grep -qE ':(8999|9900)\b' || break; sleep 1; done
rm -rf "$LEDGER"
ACCTS=()
for f in "$FIX"/*.json; do
  case "$(basename "$f")" in mint-authority.json|pob-owner.json|pob-picks.json) continue;; esac
  ACCTS+=(--account "$(basename "$f" .json)" "$f")
done
solana-test-validator --quiet --reset --ledger "$LEDGER" --rpc-port 8999 \
  --deactivate-feature "$SIMD_0500" --deactivate-feature "$SIMD_0161" \
  --bpf-program "$CORE" "$CACHE/core-mainnet.so" "${TOKEN_PROGRAM_ARGS[@]}" "${ACCTS[@]}" &
VPID=$!
for i in $(seq 1 90); do solana -u "$RPC" cluster-version >/dev/null 2>&1 && break
  kill -0 $VPID 2>/dev/null || die "validator died"; sleep 1; done
token_programs_verify "$CACHE" "$RPC" || die "validator token-program bytes differ"
solana -u "$RPC" program dump "$CORE" "$CACHE/core-sim.so" >/dev/null 2>&1 || die "Core is not on the validator"
cmp -s "$CACHE/core-sim.so" "$CACHE/core-mainnet.so" || die "on-chain Core differs from the pinned dump"
UA="$CACHE/upgrade-authority.json"
[ -s "$UA" ] || solana-keygen new --no-bip39-passphrase -s -o "$UA" >/dev/null
solana -u "$RPC" airdrop 500 "$(solana-keygen pubkey "$UA")" >/dev/null
for f in $PROGS; do
  solana -u "$RPC" program deploy "$ROOT/target/deploy/$f.so" --program-id "$ROOT/target/deploy/$f-keypair.json" \
    --keypair "$UA" --upgrade-authority "$UA" >/dev/null || die "deploy $f"
done

echo "[5/5] the Test Vault"
RC=0; OUT=$(npx tsx "$ROOT/sim/test-vault.ts" 2>&1) || RC=$?
echo "$OUT"
[ "$RC" -eq 0 ] || die "the Test Vault simulation failed (exit $RC)"
LINE=$(grep -oE '^[0-9]+/[0-9]+ test-vault assertions as predicted' <<<"$OUT" | tail -1)
[ -n "$LINE" ] || die "could not read the assertion count"
P=${LINE%%/*}; T=$(sed 's#^[0-9]*/##; s# .*##' <<<"$LINE")
[ "$P" = "$T" ] || die "$P of $T — a partial pass is not a pass"
# THE FLOOR EQUALS THE COUNT, as in run-tests.sh: deleting an arm turns this red.
SIM_FLOOR=71   # round 25: + S8.1a (N5), S9b.0-2 (two redemptions in one v0 transaction at a cap of two)
[ "$T" -eq "$SIM_FLOOR" ] || die "the simulation made $T assertions but SIM_FLOOR says $SIM_FLOOR; move the floor with the file"
echo "  $P/$T, floor $SIM_FLOOR"
