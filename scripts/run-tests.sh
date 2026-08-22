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
# NOT /tmp: it is world-writable, and this directory holds the Core binary every
# gate below compares against.
CACHE="${CBOB_CACHE:-/opt/cbob-vaults/.cache}"
LEDGER="$CACHE/test-ledger"
CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
SIMD_0500=B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g   # disable deploy v0/v1/v2
SIMD_0161=TestFeature11111111111111111111111111111111    # disable exec of v0
RPC=http://127.0.0.1:8999
PROGS="cbob_vaults cbob_vault_mint cbob_vault_burn cbob_vault_gov"
mkdir -p "$CACHE"
die(){ echo "FATAL: $*" >&2; exit 1; }
cleanup(){
  # comm is truncated to 15 chars: `pkill -x solana-test-validator` never matches.
  pkill -x solana-test-val 2>/dev/null || true
  # Decisive: free the exact ports we need, whoever holds them.
  fuser -k -TERM 8999/tcp 9900/tcp 2>/dev/null || true
}
trap cleanup EXIT

echo "[1/7] toolchain"
cargo-build-sbf --version   # MUST read 4.1.0 / platform-tools v1.54
cargo-build-sbf --version | grep -q "platform-tools v1.54" || die "wrong platform-tools"

echo "[2/7] mainnet Core"
# A PINNED HASH, because the gate below was a tautology: the validator is booted
# with --bpf-program CORE <cache file>, then Core is dumped OFF that validator and
# compared to the same file. It cannot fail for the reason it claims to guard. The
# only real validation was four bytes of ELF magic, and the cache defaults into
# world-writable /tmp — so a mock planted there produced a green run under a banner
# saying "verified byte-identical to mainnet". Set CBOB_CORE_SHA256 the first time
# from a dump you trust; after that it is the thing being checked.
# PINNED 2026-08-22 from a fresh `solana program dump` off mainnet, verified
# twice from independent dumps. If Metaplex upgrade Core this must be re-pinned
# DELIBERATELY, from a dump you have reason to trust — and the fact that it has
# to be re-pinned is itself the notification that Core changed underneath us.
# HARDCODED, NOT OVERRIDABLE. It was `${CBOB_CORE_SHA256:-…}`, which is the same
# defeat-by-environment the assertion floor had: anyone who would point CBOB_CACHE
# at a mock would set the expected hash to match it. Re-pinning Core is a source
# edit and a commit, which is the point — a Metaplex upgrade should be a decision.
CORE_SHA256_EXPECTED=f03e75373ae9cae07b5875f7818c55147b73c5607ca0f96968bab93cd583dc6e
# validate the CACHE FORMAT, not just its existence
if [ ! -s "$CACHE/core-mainnet.so" ] || [ "$(head -c4 "$CACHE/core-mainnet.so" | xxd -p)" != "7f454c46" ]; then
  MRPC=$(grep -hoE '^HELIUS_RPC_URL=.*' /opt/gary-club/.env.local 2>/dev/null | head -1 | cut -d= -f2-)
  solana program dump -u "${MRPC:-https://api.mainnet-beta.solana.com}" "$CORE" "$CACHE/core-mainnet.so"
fi
[ "$(head -c4 "$CACHE/core-mainnet.so" | xxd -p)" = "7f454c46" ] || die "cached Core is not an ELF"
CORE_SHA_FULL=$(sha256sum "$CACHE/core-mainnet.so" | cut -d' ' -f1)
[ "$CORE_SHA_FULL" = "$CORE_SHA256_EXPECTED" ] \
  || die "cached Core sha256 $CORE_SHA_FULL does not match the pinned $CORE_SHA256_EXPECTED — the cache is not the mainnet Core this suite was written against"
echo "  cache matches the PINNED mainnet sha256"
CORE_SHA=$(echo "$CORE_SHA_FULL" | cut -c1-16)
echo "  core-mainnet.so sha256=$CORE_SHA $(stat -c%s "$CACHE/core-mainnet.so") bytes"

# DEFENCE IN DEPTH, and it is a config read, not a behavioural proof — which is
# why the two places that actually depend on it now use `checked_sub` instead.
# It is kept because it guards every OTHER arithmetic site across four programs,
# and losing it would be silent.
grep -qE '^overflow-checks *= *true' "$ROOT/Cargo.toml" \
  || die "workspace release profile has lost overflow-checks = true"

echo "[3/7] build --arch v3"
cd "$ROOT" && cargo-build-sbf --arch v3 --features localnet 2>&1 | grep -viE "^\s*(Compiling|Checking|warning)" | tail -3
for f in $PROGS; do cp -f "$ROOT/target/sbpfv3-solana-solana/release/$f.so" "$ROOT/target/deploy/$f.so"; done

echo "[4/7] fresh validator"
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
  || die "on-chain Core differs from the dump we booted it with — refusing to test"
echo "  Core on the validator is byte-identical to the cache ($CORE_SHA)"
echo "  ...and the cache is the pinned mainnet build" 

echo "[5/7] deploy upgradeable (NOT --bpf-program, which FREEZES the authority)"
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

echo "[6/7] === OFF-CHAIN SELFTESTS ==="
# The on-chain suite says nothing about the pipeline that carries what the
# programs structurally cannot. Both of these prove every detector in BOTH
# directions, and a green validator run that skipped them proves nothing about
# the alarm, the lock, or the payout arithmetic.
cd "$ROOT"
node bank/selftest.mjs | tail -3
node bank/distribute.mjs --selftest | tail -2
# THE TWO FACTS A LOCAL VALIDATOR CANNOT TEST: that the signature walk pages
# correctly against a genuinely busy program, and that cbBTC and both other
# reserve mints are classic SPL with no extensions. The probe existed and was
# wired into nothing, so "asserted permanently" meant asserted once by hand.
# A box with no network SKIPS it loudly rather than failing the build — but a
# probe that RUNS and fails is fatal, because that is a real answer.
if node -e "require('dns').promises.lookup('api.mainnet-beta.solana.com').then(()=>process.exit(0),()=>process.exit(1))" 2>/dev/null; then
  node scripts/probe-mainnet-facts.mjs | tail -2 || { echo "MAINNET PROBE FAILED"; exit 1; }
else
  echo "  SKIPPED scripts/probe-mainnet-facts.mjs — no network. The mainnet facts are NOT asserted by this run."
fi

echo; echo "[7/7] === TEST SUITE ==="
# AN ASSERTION FLOOR, AND IT IS NOT OVERRIDABLE.
#
# The exit code alone cannot tell "everything passed" from "the suite stopped
# early and passed what it reached". Round 6 added a floor and then made it an
# env var — defeated by the very mechanism it guards, since anyone who would set
# CBOB_TEST_FILE to a smaller suite would set CBOB_MIN_ASSERTIONS too. It is
# hardcoded, the suite file cannot be swapped, and the numerator must equal the
# denominator so a partial pass is not a pass.
# ROUND 12: this said 160 against a 217-assertion suite, so deleting every
# round-11 assertion — including the three that exist only because earlier
# "passes" were false — still exited 0. A floor 26% below reality is the same
# defeat as making it an env var, just by never moving the constant. It is the
# CURRENT count and it moves with the suite.
MIN_ASSERTIONS=227
[ -z "${CBOB_TEST_FILE:-}" ] || die "CBOB_TEST_FILE is set. This runner certifies ONE suite; point it somewhere else and the floor below means nothing." 
# `OUT=$(cmd); RC=$?` is wrong under `set -e`: the assignment inherits the
# command's status and the shell exits before RC is ever read.
RC=0
OUT=$(cd "$ROOT" && npx tsx "$ROOT/tests/3prog.test.ts" 2>&1) || RC=$?
echo "$OUT"
[ "$RC" -eq 0 ] || die "test suite failed (exit $RC)"
LINE=$(grep -oE '^[0-9]+/[0-9]+ as predicted' <<<"$OUT" | tail -1)
[ -n "$LINE" ] || die "could not read the assertion count out of the suite output"
PASSED=${LINE%%/*}; TOTAL=$(sed 's#^[0-9]*/##; s# .*##' <<<"$LINE")
[ "$PASSED" = "$TOTAL" ] || die "suite reported $PASSED of $TOTAL — a partial pass is not a pass"
[ "$TOTAL" -ge "$MIN_ASSERTIONS" ] || die "suite made only $TOTAL assertions, floor is $MIN_ASSERTIONS — it stopped early"
echo "  $PASSED/$TOTAL assertions, floor $MIN_ASSERTIONS" 
