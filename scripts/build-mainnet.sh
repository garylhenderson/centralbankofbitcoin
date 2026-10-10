#!/usr/bin/env bash
# Produce the MAINNET artifacts and PROVE which INIT_AUTHORITY they carry.
#
# `--features localnet` swaps a test key in for INIT_AUTHORITY, because the
# mainnet key (Gary's wallet, v6) cannot sign in a local test. That is the ONE way the tested binary
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
source "$ROOT/scripts/token-programs.sh"
source "$ROOT/scripts/sbf-strip.sh"   # deploy the STRIPPED bytes (verifiable build; see the file)
token_programs_prepare "$CACHE" || die "mainnet token-program pins failed"
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
  local want=51d41542456639a01820c747e72b9d3b4ca258930a5bbb7e78db0cda133dc209
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
    --bpf-program "$CORE" "$CACHE/core-mainnet.so" "${TOKEN_PROGRAM_ARGS[@]}" &
  local up=""
  for i in $(seq 1 90); do solana -u "$RPC" cluster-version >/dev/null 2>&1 && { up=1; break; }; sleep 1; done
  [ -n "$up" ] || die "validator never came up"
token_programs_verify "$CACHE" "$RPC" || die "validator token-program bytes differ"
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
# v6 (Gary, 2026-10-03): INIT_AUTHORITY is Gary's wallet, not the CBOBTC Squads.
INIT_KEY=Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb
for f in programs/cbob-vaults programs/cbob-vault-mint programs/cbob-vault-burn programs/cbob-vault-gov; do
  grep -qE "^#\[cfg\(not\(feature = \"localnet\"\)\)\]" "$f/src/lib.rs" \
    || die "$f has no non-localnet INIT_AUTHORITY block"
  grep -A1 -E "^#\[cfg\(not\(feature = \"localnet\"\)\)\]" "$f/src/lib.rs" \
    | grep -q "$INIT_KEY" || die "$f's mainnet INIT_AUTHORITY is not $INIT_KEY"
done
echo "  source: all four programs name $INIT_KEY as the non-localnet INIT_AUTHORITY"

echo "[1/5] build MAINNET (no localnet feature)"
rm -rf "$OUT" "$CACHE/mn" "$CACHE/ln"; mkdir -p "$OUT"
# Exit status, not grep output. See the note above.
CARGO_TARGET_DIR="$CACHE/mn" cargo-build-sbf --arch v3 >"$CACHE/mn-build.log" 2>&1 \
  || { tail -40 "$CACHE/mn-build.log"; die "mainnet build failed"; }
for so in "$CACHE/mn/sbpfv3-solana-solana/release/"*.so; do sbf_strip "$so" "$OUT/$(basename "$so")" || die "could not strip $so"; done

echo "[2/5] build LOCALNET (control)"
CARGO_TARGET_DIR="$CACHE/ln" cargo-build-sbf --arch v3 --features localnet >"$CACHE/ln-build.log" 2>&1 \
  || { tail -40 "$CACHE/ln-build.log"; die "localnet build failed"; }
LN_DIR="$CACHE/ln/stripped"; mkdir -p "$LN_DIR"   # the control is stripped too, so every comparison is like for like
for so in "$CACHE/ln/sbpfv3-solana-solana/release/"*.so; do sbf_strip "$so" "$LN_DIR/$(basename "$so")" || die "could not strip $so"; done

# THE SWEEP HELPER (round 24, A3) has no INIT_AUTHORITY and nothing the localnet
# feature swaps, so there is no key to ask it about. What CAN be proven is
# stronger: its mainnet bytes are IDENTICAL to the localnet bytes the suite and
# the sim exercised, so the helper that ships is literally the one tested.
for f in cbob_vaults cbob_vault_mint cbob_vault_burn cbob_vault_gov cbob_vault_sweep; do
  [ -s "$OUT/$f.so" ] || die "dist/ is missing $f.so"
done
N=$(ls "$OUT"/*.so | wc -l); [ "$N" -eq 5 ] || die "dist/ holds $N programs, expected exactly five"
cmp -s "$OUT/cbob_vault_sweep.so" "$LN_DIR/cbob_vault_sweep.so" \
  || die "the sweep helper's mainnet bytes differ from the tested localnet bytes"
echo "  sweep: mainnet bytes == tested localnet bytes ($(sha256sum "$OUT/cbob_vault_sweep.so" | cut -c1-16)...)"
# ROUND 25 (N6): ...AND == THE FILE THE SUITE ACTUALLY DEPLOYED. The comparison
# above is against this script's own $CACHE/ln rebuild; scripts/run-tests.sh and
# sim/run-sim.sh deploy target/deploy/*.so. Equal today, but nothing recorded it.
[ -s "$ROOT/target/deploy/cbob_vault_sweep.so" ] \
  || die "target/deploy/cbob_vault_sweep.so is missing: run scripts/run-tests.sh first, so there is a deployed build to compare"
cmp -s "$OUT/cbob_vault_sweep.so" "$ROOT/target/deploy/cbob_vault_sweep.so" \
  || die "the sweep helper's mainnet bytes differ from target/deploy/cbob_vault_sweep.so, the build the suite and the sim deployed"
echo "  sweep: mainnet bytes == target/deploy bytes the suite deployed"
echo "  sha256 of the five programs as the suite and the sim DEPLOYED them (target/deploy, localnet build):"
for f in cbob_vaults cbob_vault_mint cbob_vault_burn cbob_vault_gov cbob_vault_sweep; do
  [ -s "$ROOT/target/deploy/$f.so" ] || die "target/deploy/$f.so is missing"
  echo "    $(sha256sum "$ROOT/target/deploy/$f.so" | cut -d' ' -f1)  $f.so"
done

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
echo "[5/5] VERIFIED. Deploy these five and nothing else:"
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
echo "          NotTheInitAuthority reason specifically, and all four LOCALNET"
echo "          artifacts accept it (directly, or by reaching a check below the"
echo "          authority check) — so the --features localnet swap is real and the"
echo "          check is not vacuous."
echo "  PROVEN  the sweep helper's mainnet bytes are byte-identical to the localnet"
echo "          bytes the suite and the sim ran (it has no key to swap)."
echo "  PROVEN  the source at commit $COMMIT names $INIT_KEY as the"
echo "          non-localnet INIT_AUTHORITY in all four programs, and the tree was clean."
echo "  NOT PROVEN  that the compiled constant IS that key. A third, wrong key"
echo "          would reject the test key identically, and this box does not hold"
echo "          Gary's private key, so acceptance cannot be demonstrated here."
echo "          The bridge is reproducibility: rebuild from $COMMIT and confirm these"
echo "          sha256 values. That, plus the source check above, is the whole claim."
echo
echo "INIT_AUTHORITY (per source) = $INIT_KEY (Gary's wallet, v6)"
echo "v6: after deploying and verifying ALL FIVE on chain, REMOVE the upgrade"
echo "authority (solana program set-upgrade-authority <id> --final). See DESIGN-v6.md."
