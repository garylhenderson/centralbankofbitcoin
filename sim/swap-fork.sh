#!/usr/bin/env bash
# THE ROYALTY SWAP ON A MAINNET FORK. See sim/swap-fork.mjs for what it proves.
#
# Boots its OWN validator on the suite's ports, so it must never run at the same
# time as scripts/run-tests.sh or sim/run-sim.sh (each kills the others').
# Reads mainnet (Helius) to clone; sends nothing to mainnet.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT=/opt/cbob-vaults
LEDGER="$ROOT/.cache/swap-fork-ledger"
RPC=http://127.0.0.1:8999
ORCA=whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
METEORA=LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo
die(){ echo "FATAL: $*" >&2; exit 1; }
# The test runner calls this AFTER stopping its own validator, and says so.
[ "${CBOB_FORK_FROM_RUNNER:-0}" = "1" ] || ! pgrep -f "scripts/run-tests.sh|run-tests.frozen|sim/run-sim.sh" >/dev/null \
  || die "another validator job is running"
cleanup(){ pkill -x solana-test-val 2>/dev/null || true; fuser -k -TERM 8999/tcp 9900/tcp 2>/dev/null || true; }
trap cleanup EXIT
MAINNET=$(grep -hoE '^HELIUS_RPC_URL=.*' /opt/gary-club/.env.local | head -1 | cut -d= -f2-)
[ -n "$MAINNET" ] || die "no HELIUS_RPC_URL"
cd "$ROOT"
echo "[1/3] what to clone (mainnet reads only)"
ACCTS=$(node sim/swap-fork.mjs plan) || die "plan failed"
CLONES=(); for a in $ACCTS; do CLONES+=(--clone "$a"); done
echo "  ${#CLONES[@]} flags for $(wc -w <<<"$ACCTS") accounts, plus the two pool programs"
echo "[2/3] fork"
cleanup; sleep 1
for i in $(seq 1 30); do ss -ltn 2>/dev/null | grep -qE ':(8999|9900)\b' || break; sleep 1; done
rm -rf "$LEDGER"
solana-test-validator --quiet --reset --ledger "$LEDGER" --rpc-port 8999 --url "$MAINNET" \
  --clone-upgradeable-program "$ORCA" --clone-upgradeable-program "$METEORA" "${CLONES[@]}" &
VPID=$!
for i in $(seq 1 120); do solana -u "$RPC" cluster-version >/dev/null 2>&1 && break
  kill -0 $VPID 2>/dev/null || die "validator died"; sleep 1; done
# `solana account`, not `program show`: the latter needs a keypair even to read
# (the same false alarm run-tests.sh documents).
for p in $ORCA $METEORA; do solana -u "$RPC" account "$p" --output json 2>/dev/null | grep -q '"executable": true' || die "$p is not on the fork"; done
echo "[3/3] swap"
RC=0; OUT=$(node sim/swap-fork.mjs run 2>&1) || RC=$?
echo "$OUT"
[ "$RC" -eq 0 ] || die "the swap fork failed (exit $RC)"
LINE=$(grep -oE '^[0-9]+/[0-9]+ swap-fork assertions as predicted' <<<"$OUT" | tail -1)
[ -n "$LINE" ] || die "could not read the assertion count"
P=${LINE%%/*}; T=$(sed 's#^[0-9]*/##; s# .*##' <<<"$LINE")
[ "$P" = "$T" ] || die "$P of $T"
SWAP_FLOOR=16
[ "$T" -eq "$SWAP_FLOOR" ] || die "the fork made $T assertions but SWAP_FLOOR says $SWAP_FLOOR"
echo "  $P/$T, floor $SWAP_FLOOR"
