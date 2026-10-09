#!/usr/bin/env bash
# THE DRESS-REHEARSAL TREE (SPEC item 53, road step 8).
#
# The program ids are compile-time constants in the four keyed programs
# (declare_id! and each program's references to the others; the native sweep
# helper carries no id, so only its keypair is replaced) and literals in the
# off-chain code. A rehearsal at THROWAWAY ids therefore cannot run the shipped tree
# unchanged, and making the ids configurable would change the audited code.
# So the audited tree is left alone and this script produces a SEPARATE copy:
#
#   1. a detached git worktree of HEAD at $DEST (default ~/cbob-rehearsal);
#   2. five fresh program keypairs (reused if already there, so a rerun keeps
#      the same ids), installed as that tree's target/deploy keypairs;
#   3. exactly six substitutions across the code (programs, bank, scripts,
#      tests, sim, launch, Anchor.toml): the five mainnet ids, and the repo root path,
#      so the rehearsal's crank keys, locks and caches never touch production's;
#   4. THE PROOF: reversing exactly that map recreates every file of HEAD byte
#      for byte, and no file outside the map changed. A patch that did anything
#      else fails here, loudly.
#
# It writes REHEARSAL-RECORD.txt (commit, the id map, the patch's sha256) into
# the rehearsal tree. Docs and audit records keep the real ids on purpose.
# It never builds, deploys or sends anything.
set -euo pipefail
ROOT=/opt/cbob-vaults
DEST="${1:-$HOME/cbob-rehearsal}"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
die(){ echo "FATAL: $*" >&2; exit 1; }
case "$DEST" in "$ROOT"|"$ROOT"/*) die "the rehearsal tree must live outside $ROOT";; esac
cd "$ROOT"
[ -z "$(git status --porcelain -- programs bank scripts tests sim launch Anchor.toml)" ] \
  || die "the code tree is dirty; a rehearsal must come from a commit"
COMMIT=$(git rev-parse HEAD)

# name crate real-id
PROGS="seal cbob_vaults 9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273
mint cbob_vault_mint Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo
burn cbob_vault_burn 8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8
gov cbob_vault_gov 2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2
sweep cbob_vault_sweep EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa"

if [ -d "$DEST" ]; then
  [ "$(git -C "$DEST" rev-parse HEAD 2>/dev/null)" = "$COMMIT" ] \
    || die "$DEST exists at another commit; remove it (git worktree remove --force $DEST) and rerun"
  git -C "$DEST" checkout -q -- . # back to pristine HEAD before re-patching
else
  git worktree add --detach -q "$DEST" "$COMMIT"
fi

# Same dependencies, not a second install that could resolve differently.
[ -e "$DEST/node_modules" ] || ln -s "$ROOT/node_modules" "$DEST/node_modules"
KEYS="$DEST/.rehearsal-keys"; mkdir -p "$KEYS" "$DEST/target/deploy"; chmod 700 "$KEYS"
MAP="$DEST/.rehearsal-map"; : > "$MAP"
while read -r name crate real; do
  kp="$KEYS/$crate-keypair.json"
  [ -s "$kp" ] || solana-keygen new --no-bip39-passphrase -s -o "$kp" >/dev/null
  chmod 600 "$kp"
  new=$(solana-keygen pubkey "$kp")
  [ "$new" != "$real" ] || die "generated the mainnet id for $name"
  cp -f "$kp" "$DEST/target/deploy/$crate-keypair.json"
  echo "$real $new $name" >> "$MAP"
done <<< "$PROGS"
echo "$ROOT $DEST root" >> "$MAP"

# Apply, then prove. One python so the forward and reverse maps are the same data.
python3 - "$DEST" "$MAP" <<'EOF'
import hashlib, subprocess, sys
dest, mp = sys.argv[1], sys.argv[2]
pairs = [l.split()[:2] for l in open(mp) if l.strip()]
olds = [o for o, _ in pairs]; news = [n for _, n in pairs]
# No replacement may create or contain another key, or the reverse is ambiguous.
for a in olds + news:
    for b in olds + news:
        if a != b and a in b: sys.exit(f"FATAL: map key {a} is inside {b}; the reverse would be ambiguous")
files = subprocess.check_output(['git', '-C', dest, 'ls-files', '--', 'programs', 'bank', 'scripts', 'tests', 'sim', 'launch', 'Anchor.toml'], text=True).split()
changed, h = [], hashlib.sha256()
for f in files:
    p = f"{dest}/{f}"
    try: src = open(p, encoding='utf-8').read()
    except UnicodeDecodeError: continue
    if any(n in src for n in news): sys.exit(f"FATAL: {f} already contains a throwaway id or the rehearsal path")
    out = src
    for o, n in pairs: out = out.replace(o, n)
    back = out
    for o, n in pairs: back = back.replace(n, o)
    if back != src: sys.exit(f"FATAL: {f} does not reverse to HEAD")
    if out != src:
        open(p, 'w', encoding='utf-8').write(out); changed.append(f)
        h.update(f.encode()); h.update(out.encode())
# Independent of the loop above: ask git what differs, and reverse from HEAD's bytes.
diff = subprocess.check_output(['git', '-C', dest, 'diff', '--name-only'], text=True).split()
if sorted(diff) != sorted(changed): sys.exit(f"FATAL: git sees {sorted(set(diff) ^ set(changed))} differently")
for f in diff:
    head = subprocess.check_output(['git', '-C', dest, 'show', f'HEAD:{f}'])
    now = open(f"{dest}/{f}", encoding='utf-8').read()
    for o, n in pairs: now = now.replace(n, o)
    if now.encode() != head: sys.exit(f"FATAL: {f} is not HEAD under the reverse map")
# A byte-exact reverse cannot see an ABBREVIATED id (a regex or a log matcher
# written as a prefix): it is not the full string, so it is never substituted and
# the rehearsal would silently match the wrong program. Found by running the
# suite in this tree (a selftest regex). Any 4+ char prefix left over is fatal.
for f in files:
    try: now = open(f"{dest}/{f}", encoding='utf-8').read()
    except UnicodeDecodeError: continue
    for o, _ in pairs[:-1]:
        if o[:4] in now: sys.exit(f"FATAL: {f} still holds '{o[:4]}', an abbreviated mainnet id")
for need in ['programs/cbob-vaults/src/lib.rs', 'programs/cbob-vault-mint/src/lib.rs', 'programs/cbob-vault-burn/src/lib.rs', 'programs/cbob-vault-gov/src/lib.rs', 'bank/layout.mjs']:
    if need not in changed: sys.exit(f"FATAL: {need} was not patched; the map is incomplete")
open(f"{dest}/.rehearsal-files", 'w').write('\n'.join(changed) + '\n')
print(f"PATCHED {len(changed)} files; reverse map recreates HEAD exactly; patch sha256 {h.hexdigest()}")
open(f"{dest}/.rehearsal-sha", 'w').write(h.hexdigest())
EOF

{ echo "REHEARSAL TREE — NOT THE SHIPPED CODE"
  echo "source commit  $COMMIT"
  echo "made           $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "patch sha256   $(cat "$DEST/.rehearsal-sha")"
  echo "id map (mainnet -> rehearsal):"; sed 's/^/  /' "$MAP"
  echo "files patched:"; sed 's/^/  /' "$DEST/.rehearsal-files"
} > "$DEST/REHEARSAL-RECORD.txt"
cat "$DEST/REHEARSAL-RECORD.txt"
echo
echo "Next (each step a deliberate act, none run here):"
echo "  cd $DEST && ./scripts/run-tests.sh      # the patched build passes the same suite"
echo "  cd $DEST && ./scripts/build-mainnet.sh  # artifacts at the throwaway ids"
echo "Run the rehearsal with scripts/rehearsal-run.mjs: it routes every alarm, crank and"
echo "revenue notice to .rehearsal-run/notices.log (CBOB_REHEARSAL_NOTIFY), never to Gary."
echo "Run by hand, the alarm and crank still notify the box's router: use --dry-run."
