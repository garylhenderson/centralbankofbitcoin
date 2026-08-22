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
have=$(ls programs/*/src/lib.rs bank/*.mjs scripts/*.sh scripts/*.mjs tests/*.ts SPEC.md 2>/dev/null \
  | grep -v '^scripts/audit' | grep -v '^scripts/audit-coverage.sh' | sort -u)

# Every file any audit prompt has ever bundled. The prompts are the record of
# what was actually shown, which is the only thing that counts.
sent=$(grep -ohE "f\(\s*'[^']+'\s*\)" scripts/audit*.ts 2>/dev/null \
  | sed "s/f(\s*'//;s/'\s*)//" | sort -u)

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
