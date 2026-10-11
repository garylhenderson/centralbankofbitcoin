#!/usr/bin/env python3
"""Root-only harmless fixture: verify the exact activation UID and timeout path."""
import importlib.util, json, os, pathlib, pwd, sys, tempfile
sys.dont_write_bytecode = True
if os.geteuid() != 0: raise SystemExit('Run this fixture with sudo; it touches only a temporary directory.')
ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('activation', ROOT/'web/deploy/activate-public-data.py')
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
member = pwd.getpwnam('ubuntu')
with tempfile.TemporaryDirectory(prefix='cbob-identity-test-') as tmp:
 root = pathlib.Path(tmp); os.chown(root, member.pw_uid, member.pw_gid)
 record = root/'identity.json'
 code = f'''import json,os,pathlib,subprocess,sys,time
child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])
pathlib.Path({str(record)!r}).write_text(json.dumps({{'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups(),'pid':os.getpid(),'child':child.pid,'group':os.getpgrp(),'child_group':os.getpgid(child.pid)}}))
time.sleep(60)
'''
 try: a.run_first_refresh([sys.executable,'-c',code],root,timeout=1,run_as='ubuntu')
 except RuntimeError: pass
 else: raise AssertionError('Timeout did not fail')
 d=json.loads(record.read_text())
 assert (d['uid'],d['gid'],d['groups'])==(member.pw_uid,member.pw_gid,[])
 assert d['pid']==d['group']==d['child_group']
 print('ok activation drops to ubuntu with no supplementary groups')
 for pid in [d['pid'],d['child']]:
  stat=pathlib.Path(f'/proc/{pid}/stat')
  assert not stat.exists() or stat.read_text().rsplit(') ',1)[1].split()[0]=='Z', 'Refresh process survived timeout'
 print('ok timeout leaves neither the producer nor its child running')
 assert json.loads((root/'first-run.json').read_text())['timed_out']
 print('ok real identity timeout records a failed refresh')
print('public-data identity: 3/3 passed')
