#!/usr/bin/env python3
"""Run only the clean, pinned public-data worktree. Never execute the editing checkout."""
import os, pathlib, re, subprocess, sys
source = pathlib.Path(__file__).resolve().parents[2]
def git(*args):
 return subprocess.check_output(['git', '-C', str(source), *args], text=True).strip()
if not re.fullmatch(r'[a-f0-9]{40}', source.name) or git('rev-parse', 'HEAD') != source.name:
 raise SystemExit('Public-data source does not match its reviewed commit.')
if git('status', '--porcelain', '--untracked-files=all') or git('status', '--ignored', '--porcelain', '--', 'bank', 'web/src', 'web/meta', 'scripts', 'launch'):
 raise SystemExit('Public-data source contains unreviewed changes.')
if sys.argv[1:] not in ([], ['--check']):
 raise SystemExit('Usage: run-public-data.py [--check]')
# Check on every refresh, before importing any application or external package.
subprocess.run(['/usr/bin/node', str(source / 'web/deploy/check-public-data-dependencies.mjs')], cwd=source, check=True)
if sys.argv[1:] == ['--check']:
 # The tracked node_modules symlink is checked by git above. Prove that its
 # runtime imports work before a timer can be moved to this worktree.
 subprocess.run(['/usr/bin/node', '--input-type=module', '-e', "const b = await import('bs58'); if(typeof b.default.encode !== 'function') throw Error('Invalid bs58 export'); await import('@solana/web3.js'); await import('./bank/vault-index.mjs'); await import('./bank/governance-index.mjs'); await import('./web/meta/generate.mjs');"], cwd=source, check=True, stdout=subprocess.DEVNULL)
 print('Pinned public-data source is clean at ' + source.name)
elif not sys.argv[1:]:
 os.chdir(source)
 os.execv('/usr/bin/node', ['/usr/bin/node', str(source / 'bank/public-data.mjs')])
else:
 raise SystemExit('Usage: run-public-data.py [--check]')
