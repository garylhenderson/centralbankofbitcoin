#!/usr/bin/env python3
"""Credential and filesystem boundaries; no real environment or system changes."""
import importlib.util, os, pathlib, stat, sys, tempfile
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('isolation',ROOT/'web/deploy/install-job-isolation.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
raw='HELIUS_RPC_URL="https://rpc.invalid/key"\nSUPABASE_SERVICE_ROLE_KEY=fake-db\nNEXT_PUBLIC_SUPABASE_URL=https://db.gary.club\nWALLET_ENCRYPTION_KEY=must-not-copy\nCRON_SECRET=fake-cron\nMAILGUN_API_KEY=must-not-copy\n'
public=m.select_env(raw,m.PUBLIC_KEYS,m.REQUIRED).decode()
assert 'must-not-copy' not in public and 'CRON_SECRET' not in public and public.count('\n')==3
assert 'HELIUS_RPC_URL="https://rpc.invalid/key"' in public
print('ok public scope excludes wallet, mail and cron credentials and preserves quoting')
assert m.select_env(raw,{'CRON_SECRET'},{'CRON_SECRET'})==b'CRON_SECRET=fake-cron\n'
print('ok reconciliation receives only its own credential')
for invalid in [raw+'HELIUS_RPC_URL=duplicate\n',raw.replace('SUPABASE_SERVICE_ROLE_KEY=fake-db\n',''),raw.replace('fake-db','""')]:
 try:m.select_env(invalid,m.PUBLIC_KEYS,m.REQUIRED)
 except ValueError:pass
 else:raise AssertionError('ambiguous/missing/empty environment accepted')
print('ok duplicate, missing and empty required values refuse')
assert b'CBOB_PORTAL_TRADING_ENABLED=1\n' in m.select_env(raw+'CBOB_PORTAL_TRADING_ENABLED=1\n',m.PUBLIC_KEYS,m.REQUIRED)
assert b'CBOB_PORTAL_HOLDER_ACTIONS_ENABLED' not in m.select_env(raw+'CBOB_PORTAL_HOLDER_ACTIONS_ENABLED=1\n',m.PUBLIC_KEYS,m.REQUIRED)
print('ok the market flag is scoped while holder action configuration is excluded')
with tempfile.TemporaryDirectory(prefix='cbob-isolation-test-') as tmp:
 p=pathlib.Path(tmp);secret=p/'secret';m.atomic(secret,b'fixture',os.getuid(),os.getgid(),0o600)
 assert stat.S_IMODE(secret.stat().st_mode)==0o600 and secret.read_bytes()==b'fixture'
 symlink=p/'link';symlink.symlink_to(secret)
 try:m.atomic(symlink,b'overwrite',os.getuid(),os.getgid())
 except ValueError:pass
 else:raise AssertionError('symlink accepted')
 assert secret.read_bytes()==b'fixture'
 print('ok private atomic writes and symlink refusal preserve the original')
 tree=p/'tree';tree.mkdir();first=tree/'first';first.write_text('unchanged');os.chmod(first,0o600)
 (tree/'bad').symlink_to(secret)
 try:m.controlled_tree(tree,os.getuid(),os.getgid(),0o750,0o640)
 except ValueError:pass
 else:raise AssertionError('symlink state accepted')
 assert stat.S_IMODE(first.stat().st_mode)==0o600
 (tree/'bad').unlink();os.link(secret,tree/'bad')
 try:m.controlled_tree(tree,os.getuid(),os.getgid(),0o750,0o640)
 except ValueError:pass
 else:raise AssertionError('hardlinked state accepted')
 assert stat.S_IMODE(first.stat().st_mode)==0o600
 print('ok full-tree validation refuses links before changing earlier entries')
 (tree/'bad').unlink();m.controlled_tree(tree,os.getuid(),os.getgid(),0o750,0o640)
 assert stat.S_IMODE(first.stat().st_mode)==0o640 and stat.S_IMODE(tree.stat().st_mode)==0o750
 print('ok regular state gets only the prescribed modes')
print('job isolation: 7 groups passed')
