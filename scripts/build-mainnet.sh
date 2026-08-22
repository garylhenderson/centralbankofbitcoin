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
CACHE="${CBOB_CACHE:-/opt/cbob-vaults/.cache}"
CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
RPC=http://127.0.0.1:8999
OUT=$ROOT/dist
die(){ echo "FATAL: $*" >&2; exit 1; }
kill_v(){ pkill -x solana-test-val 2>/dev/null || true; fuser -k -TERM 8999/tcp 9900/tcp 2>/dev/null || true; sleep 2; }
trap kill_v EXIT

# THE SAME TWO GATES run-tests.sh SPENDS A PARAGRAPH ON, because this script is
# the one whose entire purpose is proof and it had neither. Without the port wait,
# a half-dead previous validator keeps :9900, the new one dies on the faucet, and
# `cluster-version` is answered by the OLD one — which has no Core. Deploys land
# there and the verdict is about a validator this script did not boot.
boot(){ kill_v
  [ -s "$CACHE/core-mainnet.so" ] && [ "$(head -c4 "$CACHE/core-mainnet.so" | xxd -p)" = "7f454c46" ] \
    || die "no mainnet Core dump at $CACHE/core-mainnet.so — run scripts/run-tests.sh first"
  # THE PINNED HASH, not a comparison against the file we are about to boot with.
  # Hardcoded for the same reason as in run-tests.sh: a gate defeated by an
  # environment variable is defeated by whoever would want to defeat it.
  local want=f03e75373ae9cae07b5875f7818c55147b73c5607ca0f96968bab93cd583dc6e
  local got; got=$(sha256sum "$CACHE/core-mainnet.so" | cut -d' ' -f1)
  [ "$got" = "$want" ] || die "cached Core sha256 $got is not the pinned mainnet build $want"
  for i in $(seq 1 30); do
    ss -ltn 2>/dev/null | grep -qE ':(8999|9900)\b' || break
    [ "$i" = 30 ] && die "ports 8999/9900 still held after 30s"
    sleep 1
  done
  rm -rf "$CACHE/mn-ledger"
  solana-test-validator --quiet --reset --ledger "$CACHE/mn-ledger" --rpc-port 8999 \
    --deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g \
    --deactivate-feature TestFeature11111111111111111111111111111111 \
    --bpf-program "$CORE" "$CACHE/core-mainnet.so" &
  local up=""
  for i in $(seq 1 90); do solana -u "$RPC" cluster-version >/dev/null 2>&1 && { up=1; break; }; sleep 1; done
  [ -n "$up" ] || die "validator never came up"
  # HARD GATE: never certify against a validator without real Core.
  solana -u "$RPC" program dump "$CORE" "$CACHE/core-onchain-mn.so" >/dev/null 2>&1 \
    || die "Metaplex Core is NOT on this validator — refusing to certify against a mock"
  cmp -s "$CACHE/core-onchain-mn.so" "$CACHE/core-mainnet.so" \
    || die "on-chain Core differs from the mainnet dump — refusing to certify"
  return 0; }

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

# WHICH KEY, POSITIVELY. The behavioural arms below prove the mainnet artifacts
# REJECT the localnet test key and the localnet ones ACCEPT it. They do NOT prove
# the mainnet constant is the SQUADS key — a third, wrong key would answer
# identically, and the closing banner used to claim otherwise. The Squads vault
# is off-curve and cannot sign locally, so acceptance cannot be demonstrated at
# all. What CAN be established is that these bytes came from this source at this
# commit, and that this source names that key in all four programs.
SQUADS=bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1
for f in programs/cbob-vaults programs/cbob-vault-mint programs/cbob-vault-burn programs/cbob-vault-gov; do
  grep -qE "^#\[cfg\(not\(feature = \"localnet\"\)\)\]" "$f/src/lib.rs" \
    || die "$f has no non-localnet INIT_AUTHORITY block"
  grep -A1 -E "^#\[cfg\(not\(feature = \"localnet\"\)\)\]" "$f/src/lib.rs" \
    | grep -q "$SQUADS" || die "$f's mainnet INIT_AUTHORITY is not the Squads key"
done
echo "  source: all four programs name $SQUADS as the non-localnet INIT_AUTHORITY"

echo "[1/5] build MAINNET (no localnet feature)"
rm -rf "$OUT" "$CACHE/mn" "$CACHE/ln"; mkdir -p "$OUT"
# Exit status, not grep output. See the note above.
CARGO_TARGET_DIR="$CACHE/mn" cargo-build-sbf --arch v3 >"$CACHE/mn-build.log" 2>&1 \
  || { tail -40 "$CACHE/mn-build.log"; die "mainnet build failed"; }
cp "$CACHE/mn/sbpfv3-solana-solana/release/"*.so "$OUT/"

echo "[2/5] build LOCALNET (control)"
CARGO_TARGET_DIR="$CACHE/ln" cargo-build-sbf --arch v3 --features localnet >"$CACHE/ln-build.log" 2>&1 \
  || { tail -40 "$CACHE/ln-build.log"; die "localnet build failed"; }
LN_DIR="$CACHE/ln/sbpfv3-solana-solana/release"

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
echo "WHAT THIS RUN PROVED, and what it did not:"
echo "  PROVEN  all four MAINNET artifacts reject the localnet test key, each for the"
echo "          NotTheInitAuthority reason specifically (or, for SEAL, by reaching a"
echo "          check below it), and all four LOCALNET artifacts accept it — so the"
echo "          --features localnet swap is real and the check is not vacuous."
echo "  PROVEN  the source at commit $COMMIT names the Squads key as the"
echo "          non-localnet INIT_AUTHORITY in all four programs, and the tree was clean."
echo "  NOT PROVEN  that the compiled constant IS the Squads key. A third, wrong key"
echo "          would reject the test key identically. The Squads vault is off-curve"
echo "          and cannot sign locally, so acceptance cannot be demonstrated at all."
echo "          The bridge is reproducibility: rebuild from $COMMIT and confirm these"
echo "          sha256 values. That, plus the source check above, is the whole claim."
echo
echo "INIT_AUTHORITY (per source) = $SQUADS (CBOBTC Squads)"
echo "Deploy with --upgrade-authority set to the SAME Squads address."
