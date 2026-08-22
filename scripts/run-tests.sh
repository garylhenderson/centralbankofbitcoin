#!/usr/bin/env bash
# Repeatable green-baseline run for the three CBOB vault programs.
#
# WHY A FRESH LEDGER EVERY TIME: the config PDAs SURVIVE a program redeploy, and
# `collection` is deliberately non-rotatable. Re-running against a used ledger
# fails on already-initialised config — which is correct behaviour, not a bug.
#
# WHY --arch v3: solana-test-validator activates SIMD-0500 (which DISABLES
# deployment of SBPF v0/v1/v2) while mainnet has not. "sbpf_version ... not
# enabled" means the binary is too OLD, not too new.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT=/opt/cbob-vaults
CACHE="${CBOB_CACHE:-/tmp/cbob-vault-test}"
LEDGER="$CACHE/test-ledger"
CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
RPC=http://127.0.0.1:8999
mkdir -p "$CACHE"

echo "[1/5] toolchain"
cargo-build-sbf --version   # MUST read 4.1.0 / platform-tools v1.54

echo "[2/5] cache mainnet Core"
if [ ! -s "$CACHE/core-mainnet.so" ]; then
  solana program dump -u m "$CORE" "$CACHE/core-mainnet.so"
fi
ls -la "$CACHE/core-mainnet.so"

echo "[3/5] build --arch v3"
cd "$ROOT" && cargo-build-sbf --arch v3 2>&1 | grep -viE "^\s*(Compiling|Checking)" | tail -5
SO=$ROOT/target/sbpfv3-solana-solana/release
for f in cbob_vaults cbob_vault_mint cbob_vault_burn; do
  cp -f "$SO/$f.so" "$ROOT/target/deploy/$f.so"
done

echo "[4/5] fresh validator"
pkill -x solana-test-validator 2>/dev/null || true   # -x: -f would match this script
sleep 2; rm -rf "$LEDGER"
solana-test-validator --quiet --reset --ledger "$LEDGER" \
  --rpc-port 8999 --bpf-program "$CORE" "$CACHE/core-mainnet.so" &
for i in $(seq 1 60); do
  solana -u "$RPC" cluster-version >/dev/null 2>&1 && break; sleep 1
done
solana -u "$RPC" cluster-version

echo "[5/5] deploy (upgradeable — NOT --bpf-program, which freezes the authority)"
UA="$CACHE/upgrade-authority.json"
[ -s "$UA" ] || solana-keygen new --no-bip39-passphrase -s -o "$UA" >/dev/null
solana -u "$RPC" airdrop 500 "$(solana-keygen pubkey "$UA")" >/dev/null
for f in cbob_vaults cbob_vault_mint cbob_vault_burn; do
  solana -u "$RPC" program deploy "$ROOT/target/deploy/$f.so" \
    --program-id "$ROOT/target/deploy/$f-keypair.json" \
    --keypair "$UA" --upgrade-authority "$UA" | sed "s/^/  $f: /"
done

echo; echo "=== TEST SUITE ==="
cd /opt/gary-club && npx tsx "$ROOT/tests/3prog.test.ts"
