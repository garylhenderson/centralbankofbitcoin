# ONE TEST VALIDATOR AT A TIME, ENFORCED BY THE KERNEL (round 47, V47o-2).
#
# Every runner here boots solana-test-validator on 8999/9900, and every one kills
# any validator and frees those ports on exit. Before this, only the Core watch's
# diagnostic suite honoured a lock (a noclobber file nobody else read), so a
# certifying run started beside it died at its pin check and its exit trap killed
# the diagnostic's validator, which then emailed a false URGENT "FAILED". A crash
# also left that file behind with no pid, holding everyone off.
#
# Sourced by scripts/run-tests.sh, sim/run-sim.sh, sim/swap-fork.sh,
# scripts/build-mainnet.sh, web/test/e2e-localnet.sh, sim/rehearsal-local.sh and
# scripts/validate-core-gate.sh (round 48, V48-2); core-watch-suite.sh takes the same
# lease directly. bank/selftest.mjs FINDS every tracked script that boots or kills a
# validator and fails if one does not take it, so a new runner cannot be missed.
# `validator_lock <label>` takes flock(2) on fd 9 BEFORE the runner installs its
# exit trap, so a refused runner exits without touching anyone's validator. The
# kernel drops the lease when the holder dies, so nothing is ever left stale.
#
# A runner started BY a lock holder (the diagnostic's generated runner, run-tests'
# own swap fork, a certifying wrapper) inherits fd 9, which is the same open file
# description, so taking the lock again on it succeeds; any other process has its
# own description and is refused. A wrapper that should WAIT does:
#   exec 9>>/opt/cbob-vaults/.cache/VALIDATOR.flock; flock 9
VALIDATOR_FLOCK=/opt/cbob-vaults/.cache/VALIDATOR.flock
validator_lock() { # <label>
  [ "$(readlink -f /proc/self/fd/9 2>/dev/null)" = "$(readlink -f "$VALIDATOR_FLOCK")" ] || exec 9>>"$VALIDATOR_FLOCK" || return 1
  if ! flock -n 9; then
    echo "validator_lock: another run holds the test validator ($(cat "$VALIDATOR_FLOCK.holder" 2>/dev/null || echo unknown)); refusing to start beside it" >&2
    return 1
  fi
  echo "$1 pid $$ since $(date -u +%FT%TZ)" > "$VALIDATOR_FLOCK.holder"   # a label for the refusal message; fd 9 is the lock
}
