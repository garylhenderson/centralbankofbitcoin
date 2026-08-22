#!/usr/bin/env bash
# Produce the MAINNET artifacts and PROVE which INIT_AUTHORITY they carry.
#
# `--features localnet` swaps a test key in for INIT_AUTHORITY, because a Squads
# vault PDA cannot sign in a local test. That is the ONE way the tested binary
# differs from the shipped one, so it gets verified rather than asserted.
#
# It cannot be verified by inspection: the compiler folds the 32-byte pubkey
# compare into instruction immediates, and not even a 4-byte contiguous run of
# the key survives in the .so (measured). So this deploys BOTH builds to a real
# validator and asks each one whether it trusts the test key. The mainnet build
# must REJECT it and the localnet build must ACCEPT it. Anything else means the
# feature is not doing what its comment says.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT=/opt/cbob-vaults
CACHE=/tmp/cbob-vault-test
CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
RPC=http://127.0.0.1:8999
OUT=$ROOT/dist
die(){ echo "FATAL: $*" >&2; exit 1; }
kill_v(){ pkill -x solana-test-val 2>/dev/null || true; fuser -k -TERM 8999/tcp 9900/tcp 2>/dev/null || true; sleep 2; }
trap kill_v EXIT

boot(){ kill_v; rm -rf "$CACHE/mn-ledger"
  solana-test-validator --quiet --reset --ledger "$CACHE/mn-ledger" --rpc-port 8999 \
    --deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g \
    --deactivate-feature TestFeature11111111111111111111111111111111 \
    --bpf-program "$CORE" "$CACHE/core-mainnet.so" &
  for i in $(seq 1 90); do solana -u "$RPC" cluster-version >/dev/null 2>&1 && return 0; sleep 1; done
  die "validator never came up"; }

ask(){ # $1 = dir holding the .so to deploy
  local UA="$CACHE/upgrade-authority.json"
  solana -u "$RPC" airdrop 500 "$(solana-keygen pubkey "$UA")" >/dev/null
  solana -u "$RPC" program deploy "$1/cbob_vault_mint.so" \
    --program-id "$ROOT/target/deploy/cbob_vault_mint-keypair.json" \
    --keypair "$UA" --upgrade-authority "$UA" >/dev/null || die "deploy failed"
  cd "$ROOT" && npx tsx tests/initauth.test.ts | tail -1; }

echo "[1/4] build MAINNET (no localnet feature)"
rm -rf "$OUT"; mkdir -p "$OUT"
CARGO_TARGET_DIR=/tmp/cbob-mn cargo-build-sbf --arch v3 2>&1 | grep -E "^error" -A5 && die "mainnet build failed"
cp /tmp/cbob-mn/sbpfv3-solana-solana/release/*.so "$OUT/"

echo "[2/4] build LOCALNET (control)"
CARGO_TARGET_DIR=/tmp/cbob-ln cargo-build-sbf --arch v3 --features localnet 2>&1 | grep -E "^error" -A5 && die "localnet build failed"

echo "[3/4] ask the MAINNET build whether it trusts the test key"
boot; MN=$(ask "$OUT"); echo "  mainnet build -> $MN"
echo "[3b/4] ask the LOCALNET build the same question (proves the check is real)"
boot; LN=$(ask /tmp/cbob-ln/sbpfv3-solana-solana/release); echo "  localnet build -> $LN"

case "$MN" in *"REJECTS"*) ;; *) die "MAINNET build does NOT reject the test key: $MN";; esac
case "$LN" in *"ACCEPTS"*) ;; *) die "LOCALNET build does not accept the test key, so the control proves nothing: $LN";; esac

echo
echo "[4/4] VERIFIED. Deploy these bytes and nothing else:"
( cd "$OUT" && sha256sum *.so )
echo
echo "INIT_AUTHORITY in these artifacts = bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1 (CBOBTC Squads)"
echo "Deploy with --upgrade-authority set to the SAME Squads address."
