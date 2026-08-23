#!/usr/bin/env bash
# THE ONLY SANCTIONED WAY TO PRODUCE A BANK SIGNATURE.
#
# ⚠️ READ THIS BEFORE ASSUMING IT IS A CONTROL. It is not one, and the whole
# point of Phase 0 was to stop the repository claiming otherwise.
#
# A Solana signature is produced by whoever holds the key. Nothing in software
# can stop the holder of the Bank key from signing a redemption with `solana
# sign-offchain-message`, a wallet, or six lines of web3.js. **This script is
# PROCEDURE. The control table in SPEC.md ("THE SHIP GATE") says so in the
# column that exists for exactly this distinction, and a gate in
# bank/selftest.mjs fails the build if that column ever disagrees with what
# cron actually runs.**
#
# What it DOES buy, which is worth having and is not worth overstating:
#
#   1. ONE NAME. There is a single command to document, a single command to
#      point a runbook at, and a single string to grep for. Before this, the
#      sanctioned path was "run node with the right flags", which is a sentence,
#      not a path.
#   2. NO ROUTE TO A SIGNATURE THAT SKIPS THE SCAN. `bank/cosign.mjs` has
#      exactly one `partialSign`, and it sits downstream of the refusal exit;
#      this script adds no flag that could get past it, and REFUSES an argument
#      it does not recognise rather than forwarding it. A `--force` cannot be
#      smuggled in through the wrapper, because the wrapper does not forward
#      unknown words.
#   3. THE TRANSACTION IS NEVER AN ARGV BLOB. It comes from a file (or stdin),
#      so it is not in `ps`, not in shell history, and not subject to a paste
#      that a terminal wrapped. This also lets us reject a non-base64 byte
#      BEFORE Node sees it — `Buffer.from(s, 'base64')` SILENTLY IGNORES
#      characters outside the alphabet, so a mangled paste decodes to a
#      DIFFERENT, shorter transaction that may still parse. That is fail-open,
#      and it is the only new failure this file could have introduced, so it is
#      the one thing it checks itself.
#
# Everything that actually judges the transaction is in bank/cosign.mjs and
# bank/detectors.mjs, and is proven both ways in bank/selftest.mjs. This file
# holds no key, reads no key, and contains no judgement.
#
#   ./scripts/bank-sign.sh tx.b64           # inspect only. Needs no key.
#   ./scripts/bank-sign.sh tx.b64 --live    # inspect, then sign if clean.
#   ./scripts/bank-sign.sh -      --live    # read the transaction from stdin.
#
# Exit codes are cosign.mjs's, unchanged and not swallowed: 0 clean, 1 refused,
# 2 usage, 3 no key, 4 wrong key, 5 key mode, 9 fatal.
set -euo pipefail

# ⚠️ THE TRANSACTION IS READ BEFORE THE `cd`, AND THAT ORDER IS THE WHOLE POINT.
# The first version changed directory to the repo root first, so a relative
# `tx.b64` was resolved against the REPO instead of against the operator's shell.
# Measured: with a stale `tx.b64` sitting at the repo root, running this from
# /tmp on a different `tx.b64` fed the co-signer the REPO's file and reported
# nothing wrong. For a tool whose job is to judge a specific transaction before
# the Bank signs it, silently judging a DIFFERENT one is the worst failure
# available, and it was fail-open. Read first, `cd` after.

usage() {
  echo "usage: scripts/bank-sign.sh <tx-file|-> [--live]" >&2
  echo "  the file holds the base64 of an UNSIGNED redemption transaction" >&2
  exit 2
}

# EXACTLY ONE OR TWO ARGUMENTS, and the second may only ever be --live. An
# unrecognised word is refused, never forwarded: a wrapper that passes through
# what it does not understand is a wrapper that can be handed a flag the author
# never reviewed.
[ $# -ge 1 ] && [ $# -le 2 ] || usage
SRC=$1
LIVE=()
if [ $# -eq 2 ]; then
  [ "$2" = "--live" ] || { echo "unknown argument: $2 (only --live is accepted)" >&2; usage; }
  LIVE=(--live)
fi
case "$SRC" in --*) echo "the first argument is the transaction file, not a flag" >&2; usage;; esac

if [ "$SRC" = "-" ]; then RAW=$(cat)
else
  [ -f "$SRC" ] || { echo "no such transaction file: $SRC" >&2; exit 2; }
  RAW=$(cat -- "$SRC")
fi

# STRIP WHITESPACE, THEN DEMAND BASE64. Both halves matter: a wrapped paste is
# legitimate and must be repaired, while a stray non-alphabet byte is a MANGLED
# transaction and must be refused, because Node would decode it to a different
# one without complaining.
TX=$(printf '%s' "$RAW" | tr -d '[:space:]')
[ -n "$TX" ] || { echo "the transaction is empty — refusing to ask the Bank to judge nothing" >&2; exit 2; }
case "$TX" in
  *[!A-Za-z0-9+/=]*) echo "the transaction contains characters that are not base64 — refusing, because Node would silently ignore them and judge a DIFFERENT transaction than you pasted" >&2; exit 2;;
esac
# ⚠️ THE ALPHABET CHECK ABOVE IS NOT ENOUGH, AND THE COMMENT ON IT OVER-CLAIMED.
# Round 17 measured what it lets through:
#     'AAAAA'    5 chars -> 3 bytes   the 5th character is silently dropped
#     'AA=AAAAA' 8 chars -> 1 byte    a '=' mid-string truncates everything after
# Both are pure base64 alphabet, both pass the filter, and both decode to a
# DIFFERENT, SHORTER transaction than the operator pasted — which is precisely
# the failure the line above claims to prevent. So demand CANONICAL encoding:
# a length that is a multiple of four, and padding only at the very end.
case "$TX" in
  *=*[!=]*) echo "the transaction has '=' padding before its end — refusing: base64 decoding STOPS there, so Node would judge a truncated transaction" >&2; exit 2;;
esac
if [ $(( ${#TX} % 4 )) -ne 0 ]; then
  echo "the transaction is ${#TX} base64 characters, which is not a multiple of 4 — it is truncated or mistyped, and Node would silently discard the remainder rather than refuse" >&2
  exit 2
fi

# ONLY NOW. Everything above resolves paths in the operator's own shell; from
# here on the working directory is the repository, because that is what makes
# `bank/cosign.mjs` mean this repository's co-signer and not whatever happens to
# sit at that path wherever the operator was standing.
cd "$(dirname "$0")/.."

if [ ${#LIVE[@]} -eq 0 ]; then
  echo "INSPECT ONLY. Nothing will be signed and no key is read. Add --live to sign." >&2
else
  echo "--live: the Bank will SIGN if and only if every check below passes." >&2
fi
exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"}
