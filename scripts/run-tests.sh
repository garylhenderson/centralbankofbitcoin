#!/usr/bin/env bash
# Repeatable green-baseline run for the four CBOB vault programs and sweep helper.
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
PROGS="cbob_vaults cbob_vault_mint cbob_vault_burn cbob_vault_gov cbob_vault_sweep"
mkdir -p "$CACHE"
die(){ echo "FATAL: $*" >&2; exit 1; }
source "$ROOT/scripts/token-programs.sh"
source "$ROOT/scripts/sbf-strip.sh"   # deploy the STRIPPED bytes (verifiable build; see the file)
source "$ROOT/scripts/validator-lock.sh"   # one validator at a time, before the exit trap (round 47, V47o-2)
validator_lock run-tests || exit 1
token_programs_prepare "$CACHE" || die "mainnet token-program pins failed"
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
# twice from independent dumps. RE-PINNED 2026-10-08 (round 43): Metaplex had
# upgraded Core on 2026-09-03 (fixed fees, #300) and 2026-10-07 (v0.15.3,
# VerifiedCreators only, #302); OtterSec-verified build of 8c5cee35. Two
# independent dumps agreed; the full suite passed 912/912 against it first.
# RE-PINNED 2026-10-10: Metaplex upgraded Core again on 2026-10-09 21:21 UTC
# (slot 455005931) from an unpublished build (no release tag, not OtterSec-
# verified). Two independent dumps agreed; the full suite passed 912/912 against
# it first, with every other floor and the swap fork 16/16 (diagnostic runner,
# the probe bypassed only while measuring). scripts/core-watch.mjs now does this
# measurement on its own whenever Core moves.
# The mainnet probe now fails any run whose pin is not the deployed Core. If Metaplex upgrade Core this must be re-pinned
# DELIBERATELY, from a dump you have reason to trust — and the fact that it has
# to be re-pinned is itself the notification that Core changed underneath us.
# HARDCODED, NOT OVERRIDABLE. It was `${CBOB_CORE_SHA256:-…}`, which is the same
# defeat-by-environment the assertion floor had: anyone who would point CBOB_CACHE
# at a mock would set the expected hash to match it. Re-pinning Core is a source
# edit and a commit, which is the point — a Metaplex upgrade should be a decision.
CORE_SHA256_EXPECTED=51d41542456639a01820c747e72b9d3b4ca258930a5bbb7e78db0cda133dc209
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
for f in $PROGS; do sbf_strip "$ROOT/target/sbpfv3-solana-solana/release/$f.so" "$ROOT/target/deploy/$f.so" || die "could not strip $f.so"; done
# THE TEST-ONLY CPI WRAPPER (round 23, F8): its own workspace, built into .cache,
# deployed to THIS validator only. Never in target/deploy, never in $PROGS, so
# build-mainnet.sh and every deploy list stay blind to it.
WRAP_DIR="$CACHE/cpi-wrapper"
cargo-build-sbf --arch v3 --manifest-path "$ROOT/tests/cpi-wrapper/Cargo.toml" --sbf-out-dir "$WRAP_DIR" >/dev/null 2>&1 \
  || die "the test-only CPI wrapper did not build"

echo "[4/7] fresh validator"
cleanup
for i in $(seq 1 30); do
  ss -ltn 2>/dev/null | grep -qE ':(8999|9900)\b' || break
  [ "$i" = 30 ] && die "ports 8999/9900 still held after 30s"
  sleep 1
done
rm -rf "$LEDGER"
# STAGE 3b: A $GARY MINT AT THE REAL $GARY ADDRESS. MINT's `distribute` burns
# exactly 100 $GARY of the mint it pins by address (8c71Av...), so the suite
# needs that address to be a classic SPL mint it can mint from. Built here, not
# copied: classic SPL owner, 9 decimals (pinned against mainnet by the probe),
# supply 0, no freeze authority, and the mint authority is the suite's
# INIT_AUTHORITY test key (Gmad..., seed 0x07 x 32). Only the authority differs
# from mainnet, which has none; nothing in MINT reads it.
GARY_MINT=8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk
node -e '
const {PublicKey}=require("@solana/web3.js"); const fs=require("fs")
const d=Buffer.alloc(82); d.writeUInt32LE(1,0)
new PublicKey("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB").toBuffer().copy(d,4)
d[44]=9; d[45]=1
fs.writeFileSync(process.argv[1],JSON.stringify({pubkey:process.argv[2],account:{lamports:1461600,
  data:[d.toString("base64"),"base64"],owner:"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",executable:false,rentEpoch:0,space:82}}))
' "$CACHE/gary-mint.json" "$GARY_MINT" || die "could not build the \$GARY mint fixture"
# STAGE 3c: TWO CORE ORACLE ACCOUNTS (red-team 2 finding 1). The Giraffish Moments
# update authority (a hot wallet, kept by Gary's ruling) can add an Oracle
# external plugin, and then Core refuses any burn of a Proof of Burn that does
# not carry the oracle's account. An oracle account is just data Core reads
# (OracleValidation::V1, results at offset 0: create, transfer, burn, update;
# 0 Approved, 1 Rejected, 2 Pass), and nothing but genesis can write chosen bytes
# into an account on a validator, so they are built here. Addresses are the
# pubkeys of seeds 0x0b x 32 (burn APPROVED) and 0x0c x 32 (burn REJECTED); the
# suite derives the same two.
node -e '
const {Keypair}=require("@solana/web3.js"); const fs=require("fs")
for(const [seed,burn,file] of [[11,0,process.argv[1]],[12,1,process.argv[2]]]){
  const pk=Keypair.fromSeed(Buffer.alloc(32,seed)).publicKey.toBase58(); const d=Buffer.from([1,2,2,burn,2])
  fs.writeFileSync(file,JSON.stringify({pubkey:pk,account:{lamports:1000000,data:[d.toString("base64"),"base64"],
    owner:"11111111111111111111111111111111",executable:false,rentEpoch:0,space:d.length}}))
  console.log(pk) }
' "$CACHE/oracle-approve.json" "$CACHE/oracle-reject.json" > "$CACHE/oracles.txt" || die "could not build the oracle fixtures"
ORACLE_OK=$(sed -n 1p "$CACHE/oracles.txt"); ORACLE_NO=$(sed -n 2p "$CACHE/oracles.txt")
solana-test-validator --quiet --reset --ledger "$LEDGER" \
  --rpc-port 8999 --deactivate-feature "$SIMD_0500" --deactivate-feature "$SIMD_0161" \
  --bpf-program "$CORE" "$CACHE/core-mainnet.so" "${TOKEN_PROGRAM_ARGS[@]}" \
  --account "$GARY_MINT" "$CACHE/gary-mint.json" \
  --account "$ORACLE_OK" "$CACHE/oracle-approve.json" \
  --account "$ORACLE_NO" "$CACHE/oracle-reject.json" 9>&- &   # the validator never holds the runner's lock: a killed run frees it (V47o-2)
VPID=$!
for i in $(seq 1 90); do
  solana -u "$RPC" cluster-version >/dev/null 2>&1 && break
  kill -0 $VPID 2>/dev/null || die "validator died during startup — see above"
  [ "$i" = 90 ] && die "validator never answered on $RPC"
  sleep 1
done
echo "  agave $(solana -u "$RPC" cluster-version) pid=$VPID"

token_programs_verify "$CACHE" "$RPC" || die "validator token-program bytes differ"
# HARD GATE. Never deploy or test against a validator without real Core.
solana -u "$RPC" program dump "$CORE" "$CACHE/core-onchain.so" >/dev/null 2>&1 \
  || die "Metaplex Core is NOT on this validator — refusing to test against a mock"
cmp -s "$CACHE/core-onchain.so" "$CACHE/core-mainnet.so" \
  || die "on-chain Core differs from the dump we booted it with — refusing to test"
echo "  Core on the validator is byte-identical to the cache ($CORE_SHA)"
# Round 47 (V47o-2): this line used to only SAY so. The bytes the validator runs are
# re-hashed against the pin here, after the build, so nothing that changed the cache
# between [2/7] and the boot can pass for the pinned Core.
[ "$(sha256sum "$CACHE/core-onchain.so" | cut -d' ' -f1)" = "$CORE_SHA256_EXPECTED" ] \
  || die "the Core this validator runs is not the pinned build (the cache changed after [2/7])"
echo "  ...and it is the pinned mainnet build (re-hashed at boot)"

echo "[5/7] deploy upgradeable (NOT --bpf-program, which FREEZES the authority)"
UA="$CACHE/upgrade-authority.json"
[ -s "$UA" ] || solana-keygen new --no-bip39-passphrase -s -o "$UA" >/dev/null
solana -u "$RPC" airdrop 500 "$(solana-keygen pubkey "$UA")" >/dev/null
for f in $PROGS; do
  ID=$(solana-keygen pubkey "$ROOT/target/deploy/$f-keypair.json")
  solana -u "$RPC" program deploy "$ROOT/target/deploy/$f.so" \
    --program-id "$ROOT/target/deploy/$f-keypair.json" \
    --keypair "$UA" --upgrade-authority "$UA" >/dev/null || die "deploy $f failed"
  # `-k "$UA"`: `program show` needs a signer even to READ, and without one it
  # falls back to the GLOBAL solana CLI config. On 2026-10-03 that config named a
  # keypair file another session had deleted, so every deploy "failed" this
  # check while the program was on chain. The runner must not depend on it.
  solana -u "$RPC" -k "$UA" program show "$ID" >/dev/null 2>&1 || die "$f not on chain after deploy"
  echo "  $f -> $ID  sha256=$(sha256sum "$ROOT/target/deploy/$f.so" | cut -d' ' -f1)"
done
solana -u "$RPC" program deploy "$WRAP_DIR/cbob_test_cpi_wrapper.so" --program-id "$WRAP_DIR/cbob_test_cpi_wrapper-keypair.json" \
  --keypair "$UA" --upgrade-authority "$UA" >/dev/null || die "deploy the test-only CPI wrapper failed"
echo "  (test-only) cpi wrapper -> $(solana-keygen pubkey "$WRAP_DIR/cbob_test_cpi_wrapper-keypair.json")  sha256=$(sha256sum "$WRAP_DIR/cbob_test_cpi_wrapper.so" | cut -d' ' -f1)"

echo "[6/7] === OFF-CHAIN SELFTESTS ==="
# The on-chain suite says nothing about the pipeline that carries what the
# programs structurally cannot. Both of these prove every detector in BOTH
# directions, and a green validator run that skipped them proves nothing about
# the alarm, the lock, or the payout arithmetic.
cd "$ROOT"
# ...AND THEY GET THE SAME FLOOR THE ON-CHAIN SUITE HAS. Round 12 moved the
# on-chain floor because a floor 26% below reality is the same defeat as an env
# var. These two had NO floor at all: `set -o pipefail` makes a CRASH fail the
# build, but deleting assertions until only the easy ones remain kept it green,
# and a real share of the vault guarantee lives in these files precisely because
# the programs cannot enumerate what a PDA owns. The numbers move with the suites.
# v6 STAGE 4: the deck suite is GONE with bank/deck.mjs (levels are drawn on
# chain from slot hashes, proven in the on-chain suite). The allocation suite is
# now bank/accrual.mjs — the program's payout arithmetic mirrored for the crank
# and the alarm — and the redemption poster's copy rules get their own floor.
# ROUND 43: V43o-2 an unreadable signature is skipped after 3 passes, both ways, + the poster (+4); V43-1 the crank rescues every nested vault (+8); V43o-1 release gate x7 on a rehearsal fixture, V43o-3 reveal run x3 replacing one text-order arm (+9): 945 -> 966. Then +2: every Core pin is one value, and a drifted copy is caught: 968. Round 44 (V44-2): +4, a code-token map and an untracked build.rs (both branches) die, and the gate's five ids are layout.mjs's: 972.
# ROUND 44 (off-chain): V44o-1 poster two-signature drain/gap (+2), V44o-2 split scan and recovery (+2), V44o-3 SEAL-null baselines (+3), V44o-4 runner tail (+1), V44o-5 rehearsal notices (+2): 972 -> 982.
# ROUND 44 (the dress-rehearsal driver): its guards and the rehearsal-only overrides, both ways (+18); the release gate's ids read from web/src/config.js and the gate and driver free of literal ids (+2), the stale-tree refusal and never-refresh (+2): 982 -> 1004.
# ROUND 45 (the driver's repairs, V45-1..V45-11): the deploy key and buffer, argv, the item-22 judges, resume, the step order, the hand recovery's recorded sends (+19): 1004 -> 1023.
# ROUND 45 (the off-chain repairs, V45o-1..V45o-5): the null-SEAL ATA maps and reconcile, overrides refused at load, the frozen-pool overdue text, the flood-proof retry count, the coverage selftest before the freeze check (+9): 1023 -> 1032.
# ROUND 46 (the Phantom-signed rehearsal path and the round 46 repairs V46-1..V46-8, V46o-1..V46o-3): the init key by network, the page-mode ceremony that never signs, the upgrade steps, every multi-send step resumable, the values re-filled before step 10, the rescue's nest, handRecover after a landed swap, the key-preserving refresh, the asset-less ack on the ackable kind, the undelivered pass's unreadable counts, the paging load-time refusal (+28): 1032 -> 1060.
# ROUND 46 batch B (after the mainnet rehearsal): the driver retries a transient RPC error while it WAITS for Gary and re-reads a LANDED step's lagging read-back, both in-process and bounded; the page-mode collection recorded in the filled rehearsal file after verify and passed to the page build (+11): 1060 -> 1071.
# 2026-10-10: +1, a SHORT --to given to scripts/rehearsal-refresh.mjs is resolved and the record carries the full id (the mainnet resume refused a short one).
# ROUND 47 (V47-1, V47-2, V47-6 the README facts; V47o-2 the shared validator lock x4; V47o-6 the installer's Core watch and deadman, +1 beside the job list it updates; V47o-9 the named missing dist/): 1072 -> 1081.
# ROUND 48 (V48-2 runners found by content x2; V48o-2 the Core watch floor pair, V48-3 the web README count; V48o-3 a burnt vault's wallet; V48o-6 the SOL movement; V48o-7 the untagged jobs x2): 1081 -> 1089.
# ROUND 49 (V49-1 the machine-wide lock path; V49-2 the seal stated with its rescue exception): 1089 -> 1091.
DET_FLOOR=1091
ALLOC_FLOOR=39
POSTER_FLOOR=24
# ROUND 16: the mainnet probe had no floor at all. See the block below.
MAINNET_FLOOR=35   # round 43: +2, the deployed Core equals the pin, and is not the August one. Round 25 W1/W4: +9, Token-2022 ATA refusal + classic control + freeze authority per reserve
floor(){ # floor <label> <output> <regex> <expected>
  local n; n=$(grep -oE "$3" <<<"$2" | grep -oE '^[0-9]+' | tail -1)
  [ -n "$n" ] || die "$1: could not read an assertion count out of the output"
  [ "$n" -ge "$4" ] || die "$1: $n assertions, floor is $4 — assertions went missing"
  # ⚠️ ROUND 19. A FLOOR THAT ONLY BOUNDS BELOW ACCUMULATES SLACK, AND SLACK IS
  # EXACTLY WHAT A FLOOR IS FOR REMOVING. Measured this round: the on-chain suite
  # really produced 286 while MIN_ASSERTIONS said 284 and SPEC said 284 — the
  # self-audit added assertions and moved DET_FLOOR and ALLOC_FLOOR but not this
  # one. Nothing was red, because 286 >= 284. Two assertions could then have been
  # deleted for free, and the gate meant to stop exactly that had two assertions
  # of room in it. The comment on MIN_ASSERTIONS already said "It is the CURRENT
  # count and it moves with the suite" — a claim the `-ge` did not enforce, which
  # is this project's most repeated defect committed inside the floor mechanism.
  [ "$n" -eq "$4" ] || die "$1: $n assertions but the floor says $4 — the floor must EQUAL the count. Move it (and SPEC's stated counts) in the same commit."
}
# ⚠️ `OUT=$(cmd)` UNDER `set -e` SWALLOWS THE OUTPUT OF A FAILING COMMAND: the
# assignment inherits the status, the shell exits, and the echo never runs. The
# `| tail -3` this replaced always showed the tail, so adding the floor made a
# FAILING selftest print NOTHING — found by round 14, in the commit that added
# the floor. Capture, ALWAYS print, then judge the status explicitly.
DET_RC=0; DET_OUT=$(node bank/selftest.mjs) || DET_RC=$?
# THE REDEMPTION POST. Drafted, never sent (it has no sender); its copy rules
# are the account's canon, mechanically.
# ROUND 22 (G3): `X=$(cmd) || die` SWALLOWED the failing output (the capture
# inherits the status and nothing is printed). Capture, then print on failure.
sub_selftest(){ # sub_selftest <label> <cmd...>; sets SUB_OUT
  local rc=0; SUB_OUT=$("${@:2}" 2>&1) || rc=$?
  [ "$rc" -eq 0 ] || { echo "$SUB_OUT" | tail -30; die "$1 selftest failed (exit $rc)"; }
}
sub_selftest poster node bank/redemption-poster.mjs --selftest; POSTER_OUT=$SUB_OUT
# THE PROOF OF BURN MERKLE MODULE (v6 stage 2). The on-chain suite proves the
# Rust accepts its proofs; this proves the module refuses outsiders on its own.
POB_FLOOR=14
sub_selftest pob-merkle node scripts/pob-merkle.mjs --selftest; POB_OUT=$SUB_OUT
floor "pob-merkle" "$POB_OUT" '[0-9]+/[0-9]+ pob-merkle assertions' "$POB_FLOOR"
# THE LAUNCH VALUES (stage 3c). Every initialize value is written once and the
# programs become immutable, so the checker that refuses a wrong one BEFORE it is
# signed is proven to refuse each kind of wrong value here.
# 2026-10-11 R1: date pins and both clock-boundary controls.
LAUNCH_FLOOR=74   # round 43: +19, the dress rehearsal value set (judgeRehearsal) and the mainnet path refusing it; round 46 (V46-8): the init key by genesis, the one R43 arm made two (+1)
sub_selftest launch-params node scripts/check-launch-params.mjs --selftest; LAUNCH_OUT=$SUB_OUT
floor "launch-params" "$LAUNCH_OUT" '[0-9]+/[0-9]+ launch assertions' "$LAUNCH_FLOOR"
# Signing delivery and R1 refusal controls are part of every certification.
PREPARATION_FLOOR=98
sub_selftest launch-preparation node --test scripts/ceremony-pending.test.mjs scripts/ceremony-compare.test.mjs scripts/ceremony-receipt.test.mjs scripts/pin-review.test.mjs scripts/alarm-r1.test.mjs scripts/prelock-receipt.test.mjs scripts/live-program-reads.test.mjs web/deploy/ceremony-build.test.mjs
grep -qE "^# tests ${PREPARATION_FLOOR}$" <<<"$SUB_OUT" && grep -qE "^# pass ${PREPARATION_FLOOR}$" <<<"$SUB_OUT" && grep -qE '^# fail 0$' <<<"$SUB_OUT" || die 'launch preparation test count or pass count differs'
# ROUND 48 (V48o-2): THE CORE WATCH. Its decisions (a diagnostic result that is unreadable
# or whose run died, an earlier build's result after a second change, the probe floor it
# reads) were proven only by hand, and its selftest had no floor. Gated here, EQUAL.
CORE_WATCH_FLOOR=29
sub_selftest core-watch node scripts/core-watch.mjs --selftest; CW_OUT=$SUB_OUT
floor "core-watch" "$CW_OUT" '[0-9]+/[0-9]+ core-watch assertions' "$CORE_WATCH_FLOOR"
# 2026-10-10: THE VAULT INDEX the Vault Market renders (values, "had they waited", history). EQUAL.
VINDEX_FLOOR=14
sub_selftest vault-index node bank/vault-index.mjs --selftest; VI_OUT=$SUB_OUT
floor "vault-index" "$VI_OUT" '[0-9]+/[0-9]+ vault-index assertions' "$VINDEX_FLOOR"
# THE HOST UNIT TESTS (round 23, F9 and F7e): the skipped-slot entropy paths and
# the boost ring's wrap, which no local validator can produce. Built on the host
# from the SAME source; proven able to fail by mutation when they were written.
HOST_FLOOR=6   # round 25 (N1): + the boost schedule through the program's own functions, 260 epochs
# Round 36 (C07): the 6 includes Anchor's generated `test_id` (declare_id! emits a #[test]), not only the five written tests.
sub_selftest host-unit-tests cargo test -p cbob-vault-mint --features localnet --lib; HOST_OUT=$SUB_OUT
grep -q "test result: ok" <<<"$HOST_OUT" || die "host unit tests did not report ok"
floor "host unit tests" "$HOST_OUT" '[0-9]+ passed' "$HOST_FLOOR"
floor "poster" "$POSTER_OUT" '[0-9]+/[0-9]+ poster assertions' "$POSTER_FLOOR"
# ROUND 42 (C10): the program SOURCE in this tree (working tree, so an uncommitted
# edit counts) equals the release commit the pages pin; a program change cannot
# ride along with a pages-only round unnoticed.
# ROUND 43 (V43o-1): C10 COULD NEVER PASS IN THE DRESS-REHEARSAL TREE. That tree
# substitutes the five ids into the four keyed programs by design (item 53), so
# its program source never equals RELEASE_COMMIT and the runner died there every
# time, which made item 53's required re-run impossible. Where, and only where,
# REHEARSAL-RECORD.txt stands, the gate proves the difference is EXACTLY the
# recorded substitution instead: the map is the five programs and the root, the
# recorded files still hash to the recorded patch, the four keyed programs ARE
# patched, every differing program file is a recorded one, and the reverse map
# recreates RELEASE_COMMIT's bytes. Everywhere else C10 is unchanged.
release_gate() {
  local root=$1 rel
  rel=$(sed -n "s/^export const RELEASE_COMMIT = '\([0-9a-f]\{40\}\)'.*/\1/p" "$root/web/src/config.js")
  [ -n "$rel" ] || { echo "web/src/config.js names no RELEASE_COMMIT"; return 1; }
  # ROUND 44 (V44-2 ii): `git diff` cannot see a file git does not track, so an
  # untracked (or ignored) build.rs or source file in a program path passed both
  # branches. Anything there that is not tracked refuses, in both.
  local loose
  loose=$(git -C "$root" ls-files --others -- programs Cargo.toml Cargo.lock Anchor.toml .cargo ':(glob)**/build.rs')
  [ -z "$loose" ] || { echo "files git does not track sit in the program build paths: $(echo $loose)"; return 1; }
  if [ ! -e "$root/REHEARSAL-RECORD.txt" ]; then
    git -C "$root" diff --quiet "$rel" -- programs Cargo.toml Cargo.lock \
      || { echo "the program source differs from RELEASE_COMMIT $rel (git diff $rel -- programs Cargo.toml Cargo.lock)"; return 1; }
    echo "program source equals RELEASE_COMMIT ${rel:0:7}"; return 0
  fi
  python3 - "$root" "$rel" <<'EOF'
import hashlib, subprocess, sys
root, rel = sys.argv[1], sys.argv[2]
def no(why): print(f"REHEARSAL-RECORD.txt is present but {why}"); sys.exit(1)
try:
    pairs = [l.split() for l in open(f"{root}/.rehearsal-map") if l.strip()]
    files = [l.strip() for l in open(f"{root}/.rehearsal-files") if l.strip()]
    sha = open(f"{root}/.rehearsal-sha").read().strip()
    record = open(f"{root}/REHEARSAL-RECORD.txt").read()
except OSError as e: no(f"{e.filename} is missing")
if len(pairs) != 6 or any(len(p) != 3 for p in pairs) or sorted(p[2] for p in pairs) != ['burn', 'gov', 'mint', 'root', 'seal', 'sweep']:
    no("its id map is not the five programs and the root")
if any(o == n for o, n, _ in pairs): no("its id map leaves an id unchanged")
# ROUND 44 (V44-2 i): the NAMES and the count were checked, never the tokens, so
# any reversible swap passed as an "id map" (measured: one that rewrote BURN's
# lamport check). The left side is now exactly the five mainnet program ids (read
# below from web/src/config.js) and the release root; the right
# side five distinct 32-byte keys, none a mainnet id, and this tree's own root.
# Round 44 (found driving the rehearsal): these five ids were LITERALS here, and
# rehearsal-tree.sh substitutes every literal mainnet id under scripts/, so inside
# a rehearsal tree this list became the REHEARSAL ids and the gate refused every
# rehearsal tree. They are read from web/src/config.js MAINNET_PROGRAMS, which the
# substitution never touches (the same reason RELEASE_COMMIT is read from there);
# the selftest pins that export against bank/layout.mjs and keeps this file free
# of any literal mainnet id.
import re
try: cfg = open(f"{root}/web/src/config.js").read()
except OSError: no("web/src/config.js is missing")
blk = re.search(r"export const MAINNET_PROGRAMS = \{(.*?)\}", cfg, re.S)
MAINNET = dict(re.findall(r"(seal|mint|burn|gov|sweep): '([1-9A-HJ-NP-Za-km-z]{32,44})'", blk.group(1))) if blk else {}
if sorted(MAINNET) != ['burn', 'gov', 'mint', 'seal', 'sweep']: no("web/src/config.js names no complete MAINNET_PROGRAMS")
B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def key32(k):
    if not k or any(c not in B58 for c in k): return False
    n = 0
    for c in k: n = n * 58 + B58.index(c)
    lead = len(k) - len(k.lstrip('1'))
    return lead + (n.bit_length() + 7) // 8 == 32
import os
for o, n, name in pairs:
    if name == 'root':
        # Round 44: ASSEMBLED, because rehearsal-tree.sh rewrites the literal release
        # root under scripts/, which turned this check against every rehearsal tree.
        RELEASE_ROOT = '/opt/' + 'cbob-vaults'
        if o != RELEASE_ROOT or os.path.realpath(n) != os.path.realpath(root): no(f"its root pair is not {RELEASE_ROOT} -> this tree ({o} -> {n})")
    else:
        if o != MAINNET[name]: no(f"its {name} entry does not map the mainnet {name} id ({o})")
        if not key32(n) or n in MAINNET.values(): no(f"its {name} entry maps to {n}, not a throwaway 32-byte key")
if len({n for o, n, name in pairs if name != 'root'}) != 5: no("its id map reuses a throwaway id")
if f"patch sha256   {sha}" not in record: no("the record does not carry the recorded patch sha256")
h = hashlib.sha256()
for f in files:
    try: body = open(f"{root}/{f}", encoding='utf-8').read()
    except OSError: no(f"the recorded file {f} is missing")
    h.update(f.encode()); h.update(body.encode())
if h.hexdigest() != sha: no("the recorded files no longer hash to the recorded patch")
diff = subprocess.run(['git', '-C', root, 'diff', '--name-only', rel, '--', 'programs', 'Cargo.toml', 'Cargo.lock'], capture_output=True, text=True)
if diff.returncode: no(f"git diff against {rel} failed")
changed = diff.stdout.split()
for need in ['programs/cbob-vaults/src/lib.rs', 'programs/cbob-vault-mint/src/lib.rs', 'programs/cbob-vault-burn/src/lib.rs', 'programs/cbob-vault-gov/src/lib.rs']:
    if need not in changed: no(f"{need} is not patched")
for f in changed:
    if f not in files: no(f"{f} differs from RELEASE_COMMIT and is not a recorded rehearsal file")
    was = subprocess.run(['git', '-C', root, 'show', f'{rel}:{f}'], capture_output=True)
    if was.returncode: no(f"{f} does not exist at RELEASE_COMMIT")
    now = open(f"{root}/{f}", encoding='utf-8').read()
    for o, n, _ in pairs: now = now.replace(n, o)
    if now.encode() != was.stdout: no(f"{f} is not RELEASE_COMMIT under the reverse map")
print(f"REHEARSAL TREE: program source equals RELEASE_COMMIT {rel[:7]} under the recorded id map ({len(changed)} files)")
EOF
}
# end release_gate
GATE_MSG=$(release_gate "$ROOT") || die "$GATE_MSG"
echo "  $GATE_MSG"
# ROUND 42 (C26): the holder pages' OFFLINE tests are part of the canonical run
# (run-all.mjs holds every file to its exact floor; this holds the total).
# ROUND 43 (V43o-1): NOT in the verified rehearsal tree (the gate above has just
# proved it is one). web/ keeps the MAINNET ids and builds against the mainnet
# release build (dist/MANIFEST.txt of RELEASE_COMMIT) by design; rehearsal-tree.sh
# never patches it, so its id cross-check against the patched bank/layout.mjs
# cannot pass there (measured: ids.test 39/41, the two cross-check arms). The
# pages are gated in the audited tree, where this always runs.
# ROUND 46: +23, the hosted rehearsal page (origins, serverConfig, the program set, the nginx example), only the launch key signs, V46-5 overrides refused on mainnet-local, V46-6, V46-8 on the page, and V46o-4 the tracked placeholder fixture: 695 -> 718.
# Round 46 rehearsal page fix: +2 (a REHEARSAL-OPEN vault_collection keeps its status; the mainnet OPEN still becomes RULED).
# Round 46 rehearsal page: +7, the ceremony accepts a wallet's bounded compute-budget and Lighthouse additions and nothing else.
# Round 46 rehearsal page: +3, all seven ceremony steps as Phantom returns them pass the page and the relay; the additions alone or with a stranger's transfer are refused.
# +1: the pinned initialize discriminator recomputed.
# Round 46 stray listing (Helius refuses getProgramAccounts on Token-2022): +13, one getTokenAccountsByOwner per program with the 8-byte balance slice, each program's listing stands alone, the relay's exact shapes, and the planner names only the unlisted program: 747 -> 760.
# Round 46 batch B: +41, show my vaults (mine.test.mjs 31: every DAS lie lists nothing, the relay's shapes, the wording, the pages), the dry run on a lagging node and the bounded preflight resend (tx +5), the rehearsal ceremony's "record the collection" never names a mainnet file (ceremony +5): 760 -> 801.
# ROUND 47: V47o-8 the mock answers the page's token listing (plan +1), V47-4 the ceremony's compute floor (ceremony +2), V47-5 a demoted writable refused (tx +1): 801 -> 805.
# ROUND 48 (V48-1): a waiting vault's opening claims first, and not while the pool is frozen (plan +1): 805 -> 806.
# 2026-10-10 (Gary: "visual and like a built in marketplace"): the Vault Market's view logic and read-only rule (market +18): 806 -> 824.
# 2026-10-11: 1006 established checks, +3 saved-collection controls, +1 apex refusal.
WEB_FLOOR=1010
if [ -e "$ROOT/REHEARSAL-RECORD.txt" ]; then
  echo "  web offline SKIPPED in the recorded rehearsal tree (web/ pins the mainnet ids; gated in the audited tree)"
else
  # Round 47 (V47o-9): on a clean clone dist/ does not exist yet (it is built, not
  # committed), and the page tests read it; say so by name, after [3/7] has made the
  # target/deploy build that scripts/build-mainnet.sh compares against.
  [ -s "$ROOT/dist/SHA256SUMS" ] || die "dist/ is absent: the holder-page tests check the pages against the release build. At the release commit run scripts/build-mainnet.sh (it compares against the target/deploy build this run just made), then run this again (README.md, Reproducing the tests)"
  sub_selftest web-offline node "$ROOT/web/test/run-all.mjs"; WEB_OUT=$SUB_OUT
  grep -qE "^all ${WEB_FLOOR} offline assertions passed" <<<"$WEB_OUT" || die "web offline tests: not exactly ${WEB_FLOOR} passing (move WEB_FLOOR with the arms)"
  echo "  web offline ${WEB_FLOOR}/${WEB_FLOOR}, floor ${WEB_FLOOR}"
  # 2026-10-10 (Gary: "make sure it stays up to date"): README.md's facts block is
  # generated from the files that own each fact; a run fails while it disagrees.
  # Skipped with web/ in the rehearsal tree, whose ids are rewritten.
  node "$ROOT/scripts/readme-facts.mjs" --check || die "README.md is stale: run node scripts/readme-facts.mjs --write and commit it"
fi
echo "$DET_OUT" | tail -6
[ "$DET_RC" -eq 0 ] || die "detector selftest failed (exit $DET_RC)"
floor "detector selftest" "$DET_OUT" '[0-9]+/[0-9]+ detector assertions as predicted' "$DET_FLOOR"
ALLOC_RC=0; ALLOC_OUT=$(node bank/accrual.mjs --selftest) || ALLOC_RC=$?
echo "$ALLOC_OUT" | tail -4
[ "$ALLOC_RC" -eq 0 ] || die "allocation selftest failed (exit $ALLOC_RC)"
floor "allocation selftest" "$ALLOC_OUT" '[0-9]+/[0-9]+ allocation assertions as predicted' "$ALLOC_FLOOR"
# THE TWO FACTS A LOCAL VALIDATOR CANNOT TEST: that the signature walk pages
# correctly against a genuinely busy program, and that cbBTC and both other
# reserve mints are classic SPL with no extensions. The probe existed and was
# wired into nothing, so "asserted permanently" meant asserted once by hand.
# A box with no network SKIPS it loudly rather than failing the build — but a
# probe that RUNS and fails is fatal, because that is a real answer.
#
# ⚠️ ROUND 16: IT WAS THE ONLY ONE OF THE FOUR SUITES WITH NO FLOOR, ten lines
# below the two that have one. `node probe | tail -2` also threw the body away,
# so a human saw two lines and no floor read the count — delete every assertion
# in the probe and this stayed green, which is precisely the defect round 14
# fixed for the detector and allocation selftests and did not carry across the
# gap. One of three identical sites, in the file that enforces the other two.
# Round 23 (D4): resolve the host the probe actually uses (HELIUS_RPC_URL), not a
# different one, so "skipped, no network" means what it says.
if node -e "const u=(require('fs').readFileSync('/opt/gary-club/.env.local','utf8').match(/^HELIUS_RPC_URL=(.*)$/m)||[])[1];require('dns').promises.lookup(new URL(u.trim()).hostname).then(()=>process.exit(0),()=>process.exit(1))" 2>/dev/null; then
  MAIN_RC=0; MAIN_OUT=$(node scripts/probe-mainnet-facts.mjs) || MAIN_RC=$?
  echo "$MAIN_OUT" | tail -4
  [ "$MAIN_RC" -eq 0 ] || die "mainnet probe failed (exit $MAIN_RC)"
  floor "mainnet probe" "$MAIN_OUT" '[0-9]+/[0-9]+ as predicted' "$MAINNET_FLOOR"
else
  echo "  SKIPPED scripts/probe-mainnet-facts.mjs — no network. The mainnet facts are NOT asserted by this run."
  # THE SHIP GATE (round 22 G2, round 23 D4): a run that certifies a release may
  # not skip them.
  # Round 44 (V44o-4): an if, not `&&`: as the last statement the `&&` form made
  # the script exit 1 on a no-network box after every gate it ran had passed.
  if [ "${CBOB_SHIP_GATE:-0}" = "1" ]; then die "CBOB_SHIP_GATE=1: the mainnet probe may not be skipped"; fi
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
# ROUND 13 (v5, the burn is terminal): 227 -> 259. ROUND 14: -> 267. ROUND 15: -> 270.
# v6 STAGE 1 (no Bank, no admin, the guardian): 332 -> 358.
# v6 STAGE 2 (drawn levels, charter claim, cbBTC rounds, vote snapshot, fixed royalty): 358 -> 392.
# v6 STAGE 3 (the community pool, rescheduled draws, the crank, 3-group entropy, attribute budget): 392 -> 492.
# v6 STAGE 3b (governance reach, 2.1%/window redemption cap, 100 $GARY-or-monthly distribution, in-line monthly run): 492 -> 569.
# v6 STAGE 4 (the off-chain readers against the real programs: layout decode, the crank's attribute hash, planner order): 569 -> 576.
# v6 STAGE 3c (red-team 2: key changes need half of all vaults + notice, bounded tighten, two-step activation + join gate, skipped actions, rolling window, init cross-checks, PoB oracle pass-through; red-team 3 fixes: frozen-pool redemption, round mark, reserve mirror, claim size): 576 -> 645. Round 22 fixes (NO votes, sysvar re-derivation of the draw, waiting-vault retires, honest X.7, 6.17 cooldown, dropped tautology RL.1, reasons pinned): 645 -> 652.
# ROUND 25 (N1-N5, round-24 C7-C9 and its ship-gate-5 pins): 774 -> 829.
# ROUND 28 (frozen destination 3, large autograph A1-A4 incl. real-shape transfer/redemption simulations): 848 -> 855.
# ROUND 32 (gate 5: round 31 W1 maximum autograph + stranger signature, W2 pre-funded config/record/ATA, A22 update-authority bound): 855 -> 861.
# ROUND 33 (gate 5: worst single-signature and many-signer reveal shapes, royalty re-delegation, wSOL close): 861 -> 866.
# ROUND 34 (gate 5: full worst shape mint+reveal, ATA address cannot be taken, no-CPI read, the seal against its owner): 866 -> 871.
# ROUND 35 (item 58, rescue_nested: R35.N1-N9, N2a, N8a and five reason pins; C3, GOV mirrors MINT's round constants): 871 -> 889.
# ROUND 36 (gate 5: R36.C5 helper refuses a kept-close-authority account; R36.G2a/b reasons, each pinned): 889 -> 895.
# ROUND 40 (gate 5 U1: the largest vault's redemption at the default compute budget): 895 -> 896.
# ROUND 41 (gate 5 C8: the rent rule SPEC item 50 relies on, measured): 896 -> 899.
# ROUND 42 (gate 5: C12 a stranger-prefunded asset or collection address is refused, x3 + a fresh-address control + 3 reason pins; C8 claim-path duplicate + pin; C13 inline-capture reveal): 899 -> 909.
# ROUND 43 (gate 5, V43-1: the host's owner Core-Executes a nested vault out during the host's own crack, + the rescue then refused NotNested + its pin): 909 -> 912.
# ROUND 47 (V47-3: R.4 reads the collection's raw plugin registry, + its AppData control R.4b): 912 -> 913.
MIN_ASSERTIONS=913
[ -z "${CBOB_TEST_FILE:-}" ] || die "CBOB_TEST_FILE is set. This runner certifies ONE suite; point it somewhere else and the floor below means nothing." 
# Round 24 (C10): the suite reads the test-only wrapper's keypair from the default
# cache; a moved cache would fail red there, so refuse it here, plainly.
[ "$CACHE" = "$ROOT/.cache" ] || die "CBOB_CACHE moves the cache to $CACHE, but the suite reads the CPI wrapper from $ROOT/.cache. Unset it."
# `OUT=$(cmd); RC=$?` is wrong under `set -e`: the assignment inherits the
# command's status and the shell exits before RC is ever read.
RC=0
# STREAMED TO $CACHE/suite.log AS IT RUNS (2026-10-03). The capture alone printed
# nothing until the end, so when the validator died mid-run the suite sat in its
# retry loops for 3.5 hours with no visible output. The log shows where it is.
# `timeout` bounds the whole suite: a healthy run is well under an hour.
SUITE_LOG="$CACHE/suite.log"
OUT=$(cd "$ROOT" && timeout 7200 npx tsx "$ROOT/tests/3prog.test.ts" 2>&1 | tee "$SUITE_LOG") || RC=$?
[ "$RC" -ne 124 ] || die "the suite exceeded its 2-hour bound; see $SUITE_LOG for where it stopped"
echo "$OUT" | tail -40
[ "$RC" -eq 0 ] || die "test suite failed (exit $RC)"
LINE=$(grep -oE '^[0-9]+/[0-9]+ as predicted' <<<"$OUT" | tail -1)
[ -n "$LINE" ] || die "could not read the assertion count out of the suite output"
PASSED=${LINE%%/*}; TOTAL=$(sed 's#^[0-9]*/##; s# .*##' <<<"$LINE")
[ "$PASSED" = "$TOTAL" ] || die "suite reported $PASSED of $TOTAL — a partial pass is not a pass"
[ "$TOTAL" -ge "$MIN_ASSERTIONS" ] || die "suite made only $TOTAL assertions, floor is $MIN_ASSERTIONS — it stopped early"
# ⚠️ ROUND 19: AND IT MUST EQUAL, NOT MERELY CLEAR. See the note in floor().
[ "$TOTAL" -eq "$MIN_ASSERTIONS" ] || die "suite made $TOTAL assertions but MIN_ASSERTIONS says $MIN_ASSERTIONS — the floor must EQUAL the count. Move it and SPEC's stated counts in the same commit."
echo "  $PASSED/$TOTAL assertions, floor $MIN_ASSERTIONS" 

# THE ROYALTY SWAP ON A MAINNET FORK (round 24 M1, Gary: "Orca direct + Meteora
# fallback"). bank/swap.mjs builds both swaps by hand; only the REAL pool programs
# accepting them against REAL pool state proves that. It clones from mainnet, so
# like the mainnet probe it needs the network, and a certifying run may not skip it.
echo; echo "[+] === THE SWAP, ON A MAINNET FORK ==="
pkill -x solana-test-val 2>/dev/null || true; fuser -k -TERM 8999/tcp 9900/tcp 2>/dev/null || true
for i in $(seq 1 30); do ss -ltn 2>/dev/null | grep -qE ':(8999|9900)\b' || break; sleep 1; done
# Each budget regression gets fresh synthetic genesis state and owns the ports.
sub_selftest expiry-budget node "$ROOT/tests/expiry-budget.mjs"; EXPIRY_OUT=$SUB_OUT
echo "$EXPIRY_OUT"
EXPIRY_FLOOR=4
floor "expiry-budget" "$EXPIRY_OUT" '[0-9]+/[0-9]+ expiry-budget assertions as predicted' "$EXPIRY_FLOOR"
if node -e "const u=(require('fs').readFileSync('/opt/gary-club/.env.local','utf8').match(/^HELIUS_RPC_URL=(.*)$/m)||[])[1];require('dns').promises.lookup(new URL(u.trim()).hostname).then(()=>process.exit(0),()=>process.exit(1))" 2>/dev/null; then
  CBOB_FORK_FROM_RUNNER=1 bash "$ROOT/sim/swap-fork.sh" 2>&1 | grep -vE "Waiting for first slot|No wallet available" | tail -16
  [ "${PIPESTATUS[0]}" -eq 0 ] || die "the swap fork failed"
else
  echo "  SKIPPED sim/swap-fork.sh — no network. The swap is NOT proven by this run."
  # Round 44 (V44o-4): an if, not `&&`: as the last statement the `&&` form made
  # the script exit 1 on a no-network box after every gate it ran had passed.
  if [ "${CBOB_SHIP_GATE:-0}" = "1" ]; then die "CBOB_SHIP_GATE=1: the swap fork may not be skipped"; fi
fi
