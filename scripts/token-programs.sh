#!/usr/bin/env bash
# Source this file in validator runners. Mainnet bytes captured at slot 453760776
# (2026-10-06). The bundled Token2022 and ATA differed; classic Token matched.
# Pins are deliberate source changes, never environment overrides. These are
# SBPFv0; callers retain the same two feature deactivations required by Core.
TOKEN_PROGRAM_PINS=(
  'token TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA 8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697'
  'token2022 TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb 0999dbf708971e723b08d1caafc988826a59c6001ed6dc02260da07defbe1469'
  'ata ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL 6804554e69fd3a58caa191dc4a58f4c67223d30ca28ab8987f39fc18d2f7374d'
)
token_programs_prepare() {
  local cache="$1" row label id expected file tmp actual
  mkdir -p "$cache" || return 1
  TOKEN_PROGRAM_ARGS=()
  for row in "${TOKEN_PROGRAM_PINS[@]}"; do
    read -r label id expected <<< "$row"
    file="$cache/$label-mainnet.so"
    if [ ! -e "$file" ]; then
      tmp=$(mktemp "$cache/.$label.XXXXXX") || return 1
      if ! solana -u https://api.mainnet-beta.solana.com program dump "$id" "$tmp" >/dev/null 2>&1; then
        rm -f "$tmp"; echo "could not fetch mainnet $label" >&2; return 1
      fi
      actual=$(sha256sum "$tmp") || { rm -f "$tmp"; return 1; }
      if [ "${actual%% *}" != "$expected" ]; then
        rm -f "$tmp"; echo "mainnet $label differs from its source pin" >&2; return 1
      fi
      mv "$tmp" "$file" || return 1
    fi
    actual=$(sha256sum "$file") || return 1
    [ "${actual%% *}" = "$expected" ] || { echo "cached $label differs from its source pin" >&2; return 1; }
    TOKEN_PROGRAM_ARGS+=(--bpf-program "$id" "$file")
  done
}
token_programs_verify() {
  local cache="$1" rpc="$2" row label id expected
  # This function is only for a local test validator, never a deployment target.
  [ "$rpc" = 'http://127.0.0.1:8999' ] || { echo 'token verification requires local validator' >&2; return 1; }
  for row in "${TOKEN_PROGRAM_PINS[@]}"; do
    read -r label id expected <<< "$row"
    solana -u "$rpc" program dump "$id" "$cache/$label-on-validator.so" >/dev/null 2>&1 || return 1
    cmp -s "$cache/$label-mainnet.so" "$cache/$label-on-validator.so" || { echo "validator $label differs from mainnet pin" >&2; return 1; }
  done
  echo '  all three token programs match pinned mainnet bytes on this validator'
}
