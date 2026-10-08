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
#
# ⚠️ ROUND 29 (L1): that list was a hand-picked set of globs, so it never looked
# in sim/ or launch/, nor at the program Cargo.toml files (where the localnet
# feature lives) or the PoB set, and it reported "every file" while
# sim/fixtures.mjs, which the 71-assertion simulation runs on, had never been
# sent anywhere. Enumerate every TRACKED file under the system's directories
# instead, and name each exclusion with its reason:
#   scripts/audit*        the audit instruments themselves, not the system
#   */Cargo.lock          generated dependency pins, not authored behaviour
#   bank/.gitignore       repository housekeeping
# Exit 2 (not 1, which means "files never sent") when git itself cannot answer.
# Round 35: 'web/*', the holder pages and the launch ceremony (item 50). They
# build every transaction a holder signs, so they are part of the system.
listed=$(git ls-files 'programs/*' 'bank/*' 'scripts/*' 'sim/*' 'launch/*' 'tests/*' 'web/*' \
      SPEC.md DESIGN-v6.md HOLDER-GUIDE.md Cargo.toml Anchor.toml) \
  || { echo "audit coverage: git could not list the tracked files; refusing to report coverage"; exit 2; }
have=$(printf '%s\n' "$listed" | { grep -vE '^scripts/audit|/Cargo\.lock$|^bank/\.gitignore$' || true; } | sed '/^$/d' | sort -u)
[ -n "$have" ] || { echo "audit coverage: git listed no system files; refusing to report coverage"; exit 2; }

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

if [ -n "$never" ]; then
  echo "NEVER SENT TO ANY AUDITOR, IN ANY ROUND:"
  echo "$never" | sed 's/^/  /'
  echo
  echo "$(echo "$never" | wc -l) of $(echo "$have" | wc -l) files. Put them in the next round's bundle."
  exit 1
fi

# ⚠️ ROUND 30 (L1): A PATH IS NOT ITS CONTENT. Every file above had been bundled
# at least once, so the check passed while tests/initauth.test.ts, the probe
# behind build-mainnet's key proof, had been rewritten in six commits since the
# round-17 prompt that last showed it. So the gate now asks the question that
# matters: has an auditor seen THIS VERSION? A file is covered only if its
# current content (git blob of the working-tree file) equals its content at the
# frozen HEAD of a COMPLETED round (one with a MANIFEST, from round 19, whose
# runner counted a quorum on a pass that bundled it, and whose independent
# VERDICT's first line says QUORUM MET, round 31). A prepared round has shown
# nobody anything, so it does not count, unless `--prepared` is passed: that
# mode answers "will the next round, once it runs, deliver every current file?",
# which is the preflight question, never the freeze question.
PREPARED=0; [ "${1:-}" = "--prepared" ] && PREPARED=1
SELFTEST=0; [ "${1:-}" = "--selftest" ] && SELFTEST=1
stale=$(HAVE="$have" PREPARED=$PREPARED GATE_SELFTEST=$SELFTEST python3 - <<'PY'
import json, os, re, subprocess, sys
def first_line_quorate(line, num, focus):
    # Review 31: an EXACT, anchored headline, so made-up wording ("NO QUORUM
    # MET", "QUORUM MET for offchain; programs not reached") credits nothing.
    # Round 32 (L4): even a combined VERDICT.md credits only the focus its
    # headline names, so a PROGRAMS headline can never credit the off-chain bundle.
    label = 'PROGRAMS' if focus == 'programs' else 'OFF-CHAIN'
    # Round 44 (V44-3): the launch gate's verdicts read LAUNCH-CLEAN / NOT
    # LAUNCH-CLEAN (SPEC gate 3, 2026-10-08), which this matched never, so no
    # verdict in that vocabulary could ever be credited. Both are accepted, exactly.
    return re.fullmatch(rf'# Round {num}, {label} pass: (?:NOT )?(?:LAUNCH-)?CLEAN; QUORUM MET\s*', line) is not None
files = [l for l in os.environ['HAVE'].split('\n') if l]
if not files: sys.exit('no files to check')
def blob_now(f):
    return subprocess.run(['git', 'hash-object', f], capture_output=True, text=True, check=True).stdout.strip()
def blob_at(head, f):
    r = subprocess.run(['git', 'rev-parse', '--verify', '-q', f'{head}:{f}'], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None
def bundles(src):
    # Per focus where the script splits TARGETS on FOCUS; otherwise both foci.
    # Round 32 (programs L1): the split is found by its SHAPE, whatever the
    # spacing; a FOCUS ternary whose split cannot be found fails CLOSED rather
    # than merging both lists (which would credit a file to a pass that never
    # delivered it).
    path = re.compile(r"^[ \t]*\['([^']+)'", re.M)
    i = src.find('const TARGETS')
    if i < 0: return {'programs': set(), 'offchain': set()}
    body = src[i:]
    close = lambda t: (lambda e: t[:e.start() + 2] if e else t)(re.search(r'\n\][ \t]*(?:\n|$)', t))
    if re.match(r"const TARGETS[^=]*=\s*FOCUS\s*===\s*'programs'\s*\?\s*\[", body):
        m = re.search(r'\]\s*:\s*\[', body)
        if not m: raise SystemExit('a FOCUS-split TARGETS list whose split cannot be found')
        return {'programs': set(path.findall(body[:m.start()])), 'offchain': set(path.findall(close(body[m.end():])))}
    # Review 32: a header that mentions FOCUS but is not the recognised ternary
    # (double quotes, `!==`, ...) must not fall through to crediting both foci.
    if 'FOCUS' in body[:body.find('[\n') if '[\n' in body else 200]:
        raise SystemExit('a TARGETS header that depends on FOCUS in an unrecognised form')
    both = set(path.findall(close(body)))
    return {'programs': both, 'offchain': both}
if os.environ.get('GATE_SELFTEST') == '1':
    cases = [('# Round 31, PROGRAMS pass: NOT CLEAN; QUORUM MET\n', 31, 'programs', True),
             ('# Round 32, OFF-CHAIN pass: CLEAN; QUORUM MET\n', 32, 'offchain', True),
             ('# Round 30, PROGRAMS pass: NOT CLEAN; QUORUM NOT MET\n', 30, 'programs', False),
             ('# Round 31, PROGRAMS pass: NO QUORUM MET\n', 31, 'programs', False),
             ('# Round 31, OFF-CHAIN pass: QUORUM MET for offchain; programs quorum not reached\n', 31, 'offchain', False),
             ('# Round 31, OFF-CHAIN pass: NOT CLEAN; QUORUM MET\n', 31, 'programs', False),
             ('# Round 30, PROGRAMS pass: NOT CLEAN; QUORUM MET\n', 31, 'programs', False),
             ('# Round 20 VERDICT: QUORUM FAILED\n', 20, 'programs', False),
             ('# Round 33, PROGRAMS pass: CLEAN; QUORUM MET\n', 33, 'offchain', False),
             ('# Round 43, PROGRAMS pass: LAUNCH-CLEAN; QUORUM MET\n', 43, 'programs', True),
             ('# Round 44, OFF-CHAIN pass: NOT LAUNCH-CLEAN; QUORUM MET\n', 44, 'offchain', True),
             ('# Round 44, PROGRAMS pass: NOT LAUNCH-CLEAN; QUORUM NOT MET\n', 44, 'programs', False),
             ('# Round 44, PROGRAMS pass: LAUNCH-CLEAN for programs; QUORUM MET\n', 44, 'programs', False),
             ('# Round 44, PROGRAMS pass: QUORUM LAUNCH-CLEAN\n', 44, 'programs', False)]
    ok = sum(first_line_quorate(l, n, f) == want for l, n, f, want in cases)
    T = "const TARGETS: [string,string][] = FOCUS === 'programs' ? [\n  ['a.rs', 'x'],\n{SPLIT}  ['b.mjs', 'y'],\n]\n"
    for split in ['] : [\n', ']:[\n', ']\n  :\n  [\n']:
        b = bundles(T.replace('{SPLIT}', split))
        ok += b == {'programs': {'a.rs'}, 'offchain': {'b.mjs'}}
    for bad in [T.replace('{SPLIT}', '] ; [\n'), T.replace("FOCUS === 'programs'", 'FOCUS === "programs"').replace('{SPLIT}', '] : [\n')]:
        try: bundles(bad); closed = False
        except SystemExit: closed = True
        ok += closed
    total = len(cases) + 5
    print(f'{ok}/{total} gate assertions as predicted'); sys.exit(0 if ok == total else 1)
covered, prepared = {}, set()
scripts = sorted((int(m.group(1)), n) for n in os.listdir('scripts') for m in [re.fullmatch(r'audit(\d+)\.ts', n)] if m)
def script_at(head, name):
    r = subprocess.run(['git', 'show', f'{head}:scripts/{name}'], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None
for num, name in scripts:
    done = False
    for focus in ('programs', 'offchain'):
        mf = f'audits/round{num}/MANIFEST-{focus}.json'
        if not os.path.exists(mf): continue
        done = True
        m = json.load(open(mf))
        # The bundle is read from the script AS IT WAS at the audited commit, so
        # adding a path to an old auditN.ts later cannot credit it (review 30).
        src = script_at(m.get('head'), name) if m.get('head') else None
        if src is None: continue
        b = bundles(src)
        if not m.get('head') or m.get('auditors', 0) < m.get('required', 1 << 30): continue
        # The runner's count is not the quorum: independent triage is (round 30
        # excluded a seat the runner counted). Only a TRIAGED pass counts, and
        # never one whose verdict says the quorum failed.
        vf = next((v for v in (f'audits/round{num}/VERDICT-{focus}.md', f'audits/round{num}/VERDICT.md') if os.path.exists(v)), None)
        if not vf: continue
        # Round 31 (L1): POSITIVE evidence only. Looking for three failure phrases
        # credited any other wording ("QUORUM FAILED", plain prose, line 6). The
        # verdict's FIRST line must say QUORUM MET and nothing that negates it.
        if not first_line_quorate(open(vf).readline(), num, focus): continue
        for f in b[focus]: covered.setdefault(f, set()).add(m['head'])
    if not done and num == scripts[-1][0]:
        b = bundles(open(f'scripts/{name}').read())
        prepared = b['programs'] | b['offchain']
bad = []
for f in files:
    now = blob_now(f)
    if any(blob_at(h, f) == now for h in covered.get(f, ())): continue
    if os.environ.get('PREPARED') == '1' and f in prepared: continue
    bad.append(f)
print('\n'.join(bad))
PY
) || { [ $SELFTEST = 1 ] && { echo "$stale"; exit 1; }; echo "audit coverage: the content check could not run; refusing to report coverage"; exit 2; }
if [ $SELFTEST = 1 ]; then echo "$stale"; exit 0; fi

if [ -n "$stale" ]; then
  echo "CURRENT CONTENT NEVER SHOWN TO A COMPLETED, QUORATE ROUND$([ $PREPARED = 1 ] && echo ', NOR BUNDLED BY THE PREPARED ONE'):"
  echo "$stale" | sed 's/^/  /'
  echo
  echo "$(echo "$stale" | wc -l) of $(echo "$have" | wc -l) files. Bundle them and run a round before the freeze is declared."
  exit 1
fi
echo "audit coverage: every file's CURRENT content has been in a completed, quorate round's bundle$([ $PREPARED = 1 ] && echo ' or the prepared one') ($(echo "$have" | wc -l) files)"
exit 0
