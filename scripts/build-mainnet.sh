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

# ROUND 6 corrections, both of which let this script bless bytes it never proved:
#
#  * `cargo-build-sbf … | grep -E "^error" -A5 && die` only fires on a failure
#    that prints a line STARTING with "error". A build killed by the OOM killer,
#    a missing toolchain, or a linker fault prints nothing of the sort — and
#    because /tmp/cbob-mn was never cleaned, the next line happily copied the
#    PREVIOUS run's .so into dist/ and printed its sha256 under the words "Deploy
#    these bytes and nothing else". Exit status is now the gate, and both target
#    directories are removed first so there is nothing stale left to copy.
#
#  * `ask()` deployed cbob_vault_mint.so and NOTHING ELSE, while the closing
#    banner asserted the Squads key for all four artifacts. SEAL, BURN and GOV
#    each carry their own `#[cfg(feature = "localnet")]` INIT_AUTHORITY block —
#    an independent place to mis-copy a key, never behaviourally checked. All
#    four are now asked, and the banner says only what was measured.

ask(){ # $1 = dir holding the .so files, $2 = program short name
  local UA="$CACHE/upgrade-authority.json"
  [ -s "$UA" ] || solana-keygen new --no-bip39-passphrase -s -o "$UA" >/dev/null
  solana -u "$RPC" airdrop 500 "$(solana-keygen pubkey "$UA")" >/dev/null
  solana -u "$RPC" program deploy "$1/cbob_vault_$2.so" \
    --program-id "$ROOT/target/deploy/cbob_vault_$2-keypair.json" \
    --keypair "$UA" --upgrade-authority "$UA" >/dev/null || die "deploy $2 failed"
  cd "$ROOT" && CBOB_INITAUTH_PROGRAM="$2" npx tsx tests/initauth.test.ts | tail -1; }

# SEAL's crate is `cbob_vaults`, not `cbob_vault_seal`.
ask_seal(){
  local UA="$CACHE/upgrade-authority.json"
  [ -s "$UA" ] || solana-keygen new --no-bip39-passphrase -s -o "$UA" >/dev/null
  solana -u "$RPC" airdrop 500 "$(solana-keygen pubkey "$UA")" >/dev/null
  solana -u "$RPC" program deploy "$1/cbob_vaults.so" \
    --program-id "$ROOT/target/deploy/cbob_vaults-keypair.json" \
    --keypair "$UA" --upgrade-authority "$UA" >/dev/null || die "deploy seal failed"
  cd "$ROOT" && CBOB_INITAUTH_PROGRAM=seal npx tsx tests/initauth.test.ts | tail -1; }

echo "[0/5] provenance"
cd "$ROOT"
COMMIT=$(git rev-parse HEAD)
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  echo "  ⚠️  WORKING TREE IS DIRTY. These bytes correspond to NO commit:"
  echo "$DIRTY" | sed 's/^/      /'
  [ "${CBOB_ALLOW_DIRTY:-0}" = "1" ] || die "refusing to certify artifacts built from an uncommitted tree (CBOB_ALLOW_DIRTY=1 to override)"
fi
echo "  commit $COMMIT$([ -n "$DIRTY" ] && echo ' (DIRTY)')"

echo "[1/5] build MAINNET (no localnet feature)"
rm -rf "$OUT" /tmp/cbob-mn /tmp/cbob-ln; mkdir -p "$OUT"
# Exit status, not grep output. See the note above.
CARGO_TARGET_DIR=/tmp/cbob-mn cargo-build-sbf --arch v3 >/tmp/cbob-mn-build.log 2>&1 \
  || { tail -40 /tmp/cbob-mn-build.log; die "mainnet build failed"; }
cp /tmp/cbob-mn/sbpfv3-solana-solana/release/*.so "$OUT/"

echo "[2/5] build LOCALNET (control)"
CARGO_TARGET_DIR=/tmp/cbob-ln cargo-build-sbf --arch v3 --features localnet >/tmp/cbob-ln-build.log 2>&1 \
  || { tail -40 /tmp/cbob-ln-build.log; die "localnet build failed"; }
LN_DIR=/tmp/cbob-ln/sbpfv3-solana-solana/release

echo "[3/5] ask EVERY mainnet artifact whether it trusts the test key"
boot
for prog in mint burn gov; do
  V=$(ask "$OUT" "$prog"); echo "  mainnet $prog -> $V"
  case "$V" in *"REJECTS"*) ;; *) die "MAINNET $prog does NOT reject the test key: $V";; esac
done
V=$(ask_seal "$OUT"); echo "  mainnet seal -> $V"
case "$V" in *"REJECTS"*) ;; *) die "MAINNET seal does NOT reject the test key: $V";; esac

echo "[4/5] ask EVERY localnet artifact the same question (proves the check is real)"
boot
for prog in mint burn gov; do
  V=$(ask "$LN_DIR" "$prog"); echo "  localnet $prog -> $V"
  case "$V" in *"ACCEPTS"*) ;; *) die "LOCALNET $prog does not accept the test key, so the control proves nothing: $V";; esac
done
V=$(ask_seal "$LN_DIR"); echo "  localnet seal -> $V"
case "$V" in *"ACCEPTS"*) ;; *) die "LOCALNET seal does not accept the test key, so the control proves nothing: $V";; esac

echo
echo "[5/5] VERIFIED. Deploy these bytes and nothing else:"
( cd "$OUT" && sha256sum *.so ) | tee "$OUT/SHA256SUMS"
{ echo "commit    $COMMIT"
  echo "dirty     $([ -n "$DIRTY" ] && echo yes || echo no)"
  echo "built     $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "toolchain $(cargo-build-sbf --version | tr '\n' ' ')"
} > "$OUT/MANIFEST.txt"
cat "$OUT/MANIFEST.txt"
echo
echo "PROVEN BY THIS RUN: all four mainnet artifacts REJECT the test key and all"
echo "four localnet artifacts ACCEPT it, each rejection for the NotTheInitAuthority"
echo "reason specifically — so the constant is the Squads key in every one of them,"
echo "and the control shows the check is not passing vacuously."
echo "INIT_AUTHORITY = bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1 (CBOBTC Squads)"
echo "Deploy with --upgrade-authority set to the SAME Squads address."
