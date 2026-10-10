# Sourced, never run. THE BYTES WE DEPLOY ARE STRIPPED (2026-10-10).
#
# cargo-build-sbf writes two copies of every program: the linker's output under
# target/sbpfv3-solana-solana/release/ (with its symbol table) and a STRIPPED copy
# in target/deploy/. Since August every runner here deployed the unstripped one,
# and so did dist/. Solana's verifiable build (solana-verify, the build OtterSec
# rebuilds to mark a program verified on explorers and wallets) produces the
# stripped one. Measured on GitHub's runner in the v4.1.0 container
# (.github/workflows/verifiable-build.yml, run 38053171880): our release bytes,
# stripped with the platform-tools llvm-objcopy below, are byte-identical to
# solana-verify's rebuild for all five programs (the sweep helper with
# `-- --workspace`). Stripping removes the symbol table only; every instruction
# is unchanged. It also cuts the five ProgramData accounts from 1,801,936 to
# 1,376,584 bytes, about 2.16 SOL of rent that the lock would hold forever.
#
# So every runner deploys, and dist/ ships, exactly what sbf_strip makes, and
# the tests run the bytes that go on chain.
SBF_OBJCOPY="${HOME}/.cache/solana/v1.54/platform-tools/llvm/bin/llvm-objcopy"
sbf_strip() { # <unstripped .so> <destination>
  [ -x "$SBF_OBJCOPY" ] || { echo "sbf_strip: platform-tools v1.54 llvm-objcopy not found at $SBF_OBJCOPY" >&2; return 1; }
  [ "$(head -c4 "$1" | xxd -p)" = "7f454c46" ] || { echo "sbf_strip: $1 is not an ELF" >&2; return 1; }
  "$SBF_OBJCOPY" --strip-all "$1" "$2.tmp.$$" && mv -f "$2.tmp.$$" "$2" || { rm -f "$2.tmp.$$"; return 1; }
  [ "$(head -c4 "$2" | xxd -p)" = "7f454c46" ] || { echo "sbf_strip: stripping $1 did not leave an ELF" >&2; return 1; }
}
