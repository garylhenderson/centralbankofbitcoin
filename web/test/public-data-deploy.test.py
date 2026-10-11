#!/usr/bin/env python3
"""Exercise source guards and activation rollback without touching systemd or public data."""
import importlib.util, pathlib, subprocess, sys, tempfile
sys.dont_write_bytecode = True
ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('activation', ROOT/'web/deploy/activate-public-data.py')
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
with tempfile.TemporaryDirectory(prefix='cbob-activation-test-') as tmp:
 root = pathlib.Path(tmp)
 def setup(name, prior=True):
  r=root/name;r.mkdir();base=r/'base';target=r/'override';base.write_bytes(b'OLD CHECKOUT')
  if prior:target.write_bytes(b'OLD PIN')
  return r,base,target
 r,b,t=setup('success');backup=a.activate(b,t,r/'backups',b'DISABLED BASE',b'NEW PIN',lambda:None,lambda _:None)
 assert b.read_bytes()==b'DISABLED BASE' and t.read_bytes()==b'NEW PIN' and (backup/'override.conf').read_bytes()==b'OLD PIN'
 print('ok successful activation backs up the previous override')
 for name,prior in [('refresh-failure',True),('first-install-failure',False)]:
  r,b,t=setup(name,prior)
  def fail(_):raise RuntimeError('simulated failed refresh')
  try:a.activate(b,t,r/'backups',b'DISABLED BASE',b'NEW PIN',lambda:None,fail)
  except RuntimeError:pass
  else:raise AssertionError('failure hidden')
  assert b.read_bytes()==b'DISABLED BASE'
  assert (t.read_bytes()==b'OLD PIN') if prior else (not t.exists())
  print('ok '+name+' restores the prior pin or keeps the base disabled')
 r,b,t=setup('reload-failure');calls=[]
 def reload():
  calls.append(1)
  if len(calls)==1:raise RuntimeError('simulated daemon-reload failure')
 try:a.activate(b,t,r/'backups',b'DISABLED BASE',b'NEW PIN',reload,lambda _:None)
 except RuntimeError:pass
 assert len(calls)==2 and t.read_bytes()==b'OLD PIN' and b.read_bytes()==b'DISABLED BASE'
 print('ok daemon reload failure restores and reloads the prior override')
with tempfile.TemporaryDirectory(prefix='cbob-source-test-') as tmp:
 root=pathlib.Path(tmp);repo=root/'setup';(repo/'web/deploy').mkdir(parents=True);(repo/'web/meta').mkdir();(repo/'bank').mkdir()
 runner=(ROOT/'web/deploy/run-public-data.py').read_bytes();(repo/'web/deploy/run-public-data.py').write_bytes(runner)
 (repo/'.gitignore').write_text('bank/ignored.mjs\n');(repo/'node_modules').symlink_to((ROOT/'node_modules').resolve(),target_is_directory=True)
 fixtures=['bank/vault-index.mjs','bank/governance-index.mjs','web/meta/generate.mjs']
 for name in fixtures:(repo/name).write_text('export const fixture = true\n')
 def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL,text=True).strip()
 git('init');git('add','--','web/deploy/run-public-data.py','.gitignore','node_modules',*fixtures);git('-c','user.name=Guard Test','-c','user.email=guard@example.invalid','commit','-m','Fixture')
 commit=git('rev-parse','HEAD');new=root/commit;repo.rename(new);repo=new
 def check():return subprocess.run(['python3',str(repo/'web/deploy/run-public-data.py'),'--check'],capture_output=True,text=True).returncode
 assert check()==0;print('ok clean commit with resolving runtime imports accepted')
 (repo/'unreviewed').write_text('x');assert check()!=0;(repo/'unreviewed').unlink();print('ok untracked source refused')
 (repo/'bank/ignored.mjs').write_text('x');assert check()!=0;(repo/'bank/ignored.mjs').unlink();print('ok ignored source refused')
 (repo/'web/deploy/run-public-data.py').write_bytes(runner+b'\n# unreviewed\n');assert check()!=0;(repo/'web/deploy/run-public-data.py').write_bytes(runner);print('ok modified source refused')
 bad=root/'wrong';repo.rename(bad);repo=bad;assert check()!=0;print('ok wrong commit directory refused')
print('public-data deployment: 9/9 passed')
