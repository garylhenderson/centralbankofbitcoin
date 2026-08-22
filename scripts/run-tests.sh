#!/usr/bin/env bash
# Repeatable green-baseline run for the three CBOB vault programs.
#
# TRAPS THIS ENCODES — each one cost real time at least once:
#
#  * --arch v3. "sbpf_version required by the executable which are not enabled"
#    means the binary is too OLD, not too new.
#
#  * --deactivate-feature x2. The test validator turns on every feature it knows,
#    including ones mainnet has NOT adopted. Mainnet Core is SBPFv0 (readelf
#    Flags 0x0) and TWO active features reject it, so loading real cloned Core at
#    genesis fails with the SAME "sbpf_version not enabled" string that a stale
#    toolchain produces — which is why this reads as a toolchain bug and is not:
#      SIMD-0500  B8JJXCy5am…  disables DEPLOYMENT of SBPF v0/v1/v2
#      SIMD-0161  TestFeature1…  disables EXECUTION of SBPFv0
#    Both are unscheduled on mainnet (SIMD-0161's id is literally a TestFeature
#    placeholder), so deactivating them makes this validator MORE faithful, not
#    less. Our own programs are unaffected: SBPFv3 rides on SIMD-0178/0189/0377,
#    which stays active.
#
#  * `solana account` IS NOT `solana program dump`. The first writes the raw
#    programdata account — 45 bytes of header (enum, slot, Option<authority>)
#    before the \x7fELF magic — and --bpf-program will not load it. A cache guard
#    of `[ -s file ]` happily reuses such a file forever, so the guard checks the
#    ELF MAGIC, not merely that bytes exist.
#
#  * A FRESH ledger every run. Config PDAs SURVIVE a program redeploy and
#    `collection` is deliberately non-rotatable, so a re-run against a used
#    ledger fails on already-initialised config. That is correct behaviour.
#
#  * KILLING THE VALIDATOR IS ITS OWN TRAP. `pkill -f solana-test-validator`
#    matches this script's own command line — but `pkill -x solana-test-validator`
#    matches NOTHING, because Linux truncates comm to 15 chars and the real name
#    is `solana-test-val`. It exits 1 and the old validator lives on. Kill by the
#    truncated comm AND by whoever holds the ports.
#
#  * WAIT FOR THE PORTS, then ASSERT CORE IS PRESENT. A half-dead previous
#    validator holds :9900, the new one dies on "failed to start faucet", and
#    `cluster-version` is then answered by the OLD validator — which has no Core.
#    Deploys land on it and the suite tests nothing. A green run against the
#    wrong validator is worse than a red one, so Core's presence is a HARD GATE
#    before any deploy, and it is compared against the mainnet bytes.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT=/opt/cbob-vaults
CACHE="${CBOB_CACHE:-/tmp/cbob-vault-test}"
LEDGER="$CACHE/test-ledger"
CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
SIMD_0500=B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g   # disable deploy v0/v1/v2
SIMD_0161=TestFeature11111111111111111111111111111111    # disable exec of v0
RPC=http://127.0.0.1:8999
PROGS="cbob_vaults cbob_vault_mint cbob_vault_burn"
mkdir -p "$CACHE"
die(){ echo "FATAL: $*" >&2; exit 1; }
cleanup(){
  # comm is truncated to 15 chars: `pkill -x solana-test-validator` never matches.
  pkill -x solana-test-val 2>/dev/null || true
  # Decisive: free the exact ports we need, whoever holds them.
  fuser -k -TERM 8999/tcp 9900/tcp 2>/dev/null || true
}
trap cleanup EXIT

echo "[1/6] toolchain"
cargo-build-sbf --version   # MUST read 4.1.0 / platform-tools v1.54
cargo-build-sbf --version | grep -q "platform-tools v1.54" || die "wrong platform-tools"

echo "[2/6] mainnet Core"
# validate the CACHE FORMAT, not just its existence
if [ ! -s "$CACHE/core-mainnet.so" ] || [ "$(head -c4 "$CACHE/core-mainnet.so" | xxd -p)" != "7f454c46" ]; then
  MRPC=$(grep -hoE '^HELIUS_RPC_URL=.*' /opt/gary-club/.env.local 2>/dev/null | head -1 | cut -d= -f2-)
  solana program dump -u "${MRPC:-https://api.mainnet-beta.solana.com}" "$CORE" "$CACHE/core-mainnet.so"
fi
[ "$(head -c4 "$CACHE/core-mainnet.so" | xxd -p)" = "7f454c46" ] || die "cached Core is not an ELF"
CORE_SHA=$(sha256sum "$CACHE/core-mainnet.so" | cut -c1-16)
echo "  core-mainnet.so sha256=$CORE_SHA $(stat -c%s "$CACHE/core-mainnet.so") bytes"

echo "[3/6] build --arch v3"
cd "$ROOT" && cargo-build-sbf --arch v3 2>&1 | grep -viE "^\s*(Compiling|Checking|warning)" | tail -3
for f in $PROGS; do cp -f "$ROOT/target/sbpfv3-solana-solana/release/$f.so" "$ROOT/target/deploy/$f.so"; done

echo "[4/6] fresh validator"
cleanup
for i in $(seq 1 30); do
  ss -ltn 2>/dev/null | grep -qE ':(8999|9900)\b' || break
  [ "$i" = 30 ] && die "ports 8999/9900 still held after 30s"
  sleep 1
done
rm -rf "$LEDGER"
solana-test-validator --quiet --reset --ledger "$LEDGER" \
  --rpc-port 8999 --deactivate-feature "$SIMD_0500" --deactivate-feature "$SIMD_0161" \
  --bpf-program "$CORE" "$CACHE/core-mainnet.so" &
VPID=$!
for i in $(seq 1 90); do
  solana -u "$RPC" cluster-version >/dev/null 2>&1 && break
  kill -0 $VPID 2>/dev/null || die "validator died during startup — see above"
  [ "$i" = 90 ] && die "validator never answered on $RPC"
  sleep 1
done
echo "  agave $(solana -u "$RPC" cluster-version) pid=$VPID"

# HARD GATE. Never deploy or test against a validator without real Core.
solana -u "$RPC" program dump "$CORE" "$CACHE/core-onchain.so" >/dev/null 2>&1 \
  || die "Metaplex Core is NOT on this validator — refusing to test against a mock"
cmp -s "$CACHE/core-onchain.so" "$CACHE/core-mainnet.so" \
  || die "on-chain Core differs from the mainnet dump — refusing to test"
echo "  Core verified byte-identical to mainnet ($CORE_SHA)"

echo "[5/6] deploy upgradeable (NOT --bpf-program, which FREEZES the authority)"
UA="$CACHE/upgrade-authority.json"
[ -s "$UA" ] || solana-keygen new --no-bip39-passphrase -s -o "$UA" >/dev/null
solana -u "$RPC" airdrop 500 "$(solana-keygen pubkey "$UA")" >/dev/null
for f in $PROGS; do
  ID=$(solana-keygen pubkey "$ROOT/target/deploy/$f-keypair.json")
  solana -u "$RPC" program deploy "$ROOT/target/deploy/$f.so" \
    --program-id "$ROOT/target/deploy/$f-keypair.json" \
    --keypair "$UA" --upgrade-authority "$UA" >/dev/null || die "deploy $f failed"
  solana -u "$RPC" program show "$ID" >/dev/null 2>&1 || die "$f not on chain after deploy"
  echo "  $f -> $ID"
done

echo; echo "[6/6] === TEST SUITE ==="
cd "$ROOT" && npx tsx "${CBOB_TEST_FILE:-$ROOT/tests/3prog.test.ts}"
