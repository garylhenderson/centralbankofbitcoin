#!/usr/bin/env bash
# WHICH FILES HAS NO AUDITOR EVER SEEN?
#
# Round 14 found this by hand: FIVE files had never appeared in any audit prompt
# across THIRTEEN rounds — including `bank/anchor.mjs`, which round 12 created as
# the fix for a whole class of defect (a raw-offset read of another program's
# account that could be silently misread after an upgrade). The fix for a defect
# class had never itself been audited, and rounds 11 and 12 both produced their
# WORST findings in files no auditor had seen before.
#
# THAT IS NOT A THING TO NOTICE ONCE. It is a measurement, so it is a script.
#
# ⚠️ THIS IS A FREEZE GATE, NOT A BUILD GATE, and the difference is deliberate.
# A file written five minutes ago is legitimately unaudited; failing every commit
# on that would make the check something people route around. It gates the one
# moment that matters: before a round is declared clean and the tree is frozen,
# this must return zero. Run it as part of that decision, and read it any time
# you are choosing what the next round should look at.
#
# Ruling, Gary 2026-08-22: there will be NO human audit firm. This process is the
# certification. A file no model has ever read is a file nothing has ever read.
set -euo pipefail
cd "$(dirname "$0")/.."

# Every file that is part of the system. Tests and ops scripts are IN: a broken
# test is a false pass, and this project has shipped three of those.
# ROUND 15: the BUILD CONFIGURATION was outside this list, and it carries a
# measured fact the whole arithmetic argument rests on — `overflow-checks = true`,
# quoted to every auditor in every round as fact 6, in a file no auditor has ever
# been shown. Same for `Anchor.toml`, which pins the toolchain and the cluster.
# A coverage gate that excludes the files controlling the certification is the
# same shape as the defect it exists to catch.
have=$(ls programs/*/src/lib.rs bank/*.mjs scripts/*.sh scripts/*.mjs tests/*.ts SPEC.md \
      Cargo.toml Anchor.toml 2>/dev/null \
  | grep -v '^scripts/audit' | grep -v '^scripts/audit-coverage.sh' | sort -u)

# Every file any audit prompt has ever bundled. The prompts are the record of
# what was actually shown, which is the only thing that counts.
#
# ⚠️ AND IT STOPPED BEING ABLE TO SEE THEM. Rounds 1-18 bundled files by writing
# `f('path')` inline, and this gate read exactly that. ROUND 19 replaced that with
# a TARGETS array — `['path', 'why']` — mapped through `f()` at the end, and the
# path literal `f('bank/deck.mjs')` stopped existing anywhere. So for TWO ROUNDS
# this gate has been reporting coverage earned before round 19 and has been blind
# to fourteen files rounds 19 and 20 actually deliver.
#
# It never went red, which is exactly the problem: a gate whose subject changed
# shape underneath it goes on answering confidently about the old shape. Nothing
# measured that its input still matched what the rounds do. Both shapes now, and
# the TARGETS pattern is deliberately ANCHORED to an array-literal opening rather
# than to "a quoted path anywhere in the file" — the prompt prose names dozens of
# paths, and counting those would claim coverage for files nobody was sent, which
# is the dangerous direction for this particular gate to be wrong in.
legacy=$(grep -ohE "f\(\s*'[^']+'\s*\)" scripts/audit*.ts 2>/dev/null \
  | sed "s/f(\s*'//;s/'\s*)//" || true)
targets=$(grep -ohE "^[[:space:]]*\['[^']+'" scripts/audit*.ts 2>/dev/null \
  | sed -E "s/^[[:space:]]*\['//;s/'$//" || true)
sent=$(printf '%s\n%s\n' "$legacy" "$targets" | grep -v '^$' | sort -u)

never=$(comm -23 <(echo "$have") <(echo "$sent") || true)

if [ -z "$never" ]; then
  echo "audit coverage: every file has been in at least one audit prompt ($(echo "$have" | wc -l) files)"
  exit 0
fi
echo "NEVER SENT TO ANY AUDITOR, IN ANY ROUND:"
echo "$never" | sed 's/^/  /'
echo
echo "$(echo "$never" | wc -l) of $(echo "$have" | wc -l) files. Put them in the next round's bundle."
exit 1
