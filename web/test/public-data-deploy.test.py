#!/usr/bin/env python3
"""Exercise source guards and activation rollback without touching systemd or public data."""
import importlib.util, json, pathlib, subprocess, sys, tempfile
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
 # Restore failure must be distinguishable from a completed rollback.
 r,b,t=setup('restore-failure')
 def broken_reload(): raise RuntimeError('simulated systemctl failure')
 try:a.activate(b,t,r/'backups',b'DISABLED BASE',b'NEW PIN',broken_reload,lambda _:None)
 except a.RollbackFailed:pass
 else:raise AssertionError('restore failure hidden')
 print('ok restore failure requires manual recovery')
 r,b,t=setup('symlink-refusal');real=r/'real';real.write_bytes(b'ORIGINAL');t.unlink();t.symlink_to(real)
 try:a.activate(b,t,r/'backups',b'DISABLED BASE',b'NEW PIN',lambda:None,lambda _:None)
 except a.RollbackFailed:pass
 else:raise AssertionError('symlink unit accepted')
 assert real.read_bytes()==b'ORIGINAL'
 print('ok symlink unit is refused without changing its target')
 r=root/'refresh-tests';r.mkdir()
 a.run_first_refresh([sys.executable,'-c','print("secret-output-must-not-be-logged")'],r)
 assert json.loads((r/'first-run.json').read_text())=={'returncode':0,'timed_out':False}
 assert all('secret-output' not in f.read_text() for f in r.iterdir())
 print('ok first refresh records status without raw output')
 try:a.run_first_refresh([sys.executable,'-c','raise SystemExit(2)'],r)
 except RuntimeError:pass
 else:raise AssertionError('failed refresh accepted')
 assert json.loads((r/'first-run.json').read_text())['returncode']==2
 print('ok failed refresh is reported')
 try:a.run_first_refresh([sys.executable,'-c','import time;time.sleep(30)'],r,timeout=0.05)
 except RuntimeError:pass
 else:raise AssertionError('hung refresh accepted')
 assert json.loads((r/'first-run.json').read_text())['timed_out']
 print('ok hung refresh is killed at the deadline')
with tempfile.TemporaryDirectory(prefix='cbob-source-test-') as tmp:
 root=pathlib.Path(tmp);repo=root/'setup';(repo/'web/deploy').mkdir(parents=True);(repo/'web/meta').mkdir();(repo/'bank').mkdir()
 runner=(ROOT/'web/deploy/run-public-data.py').read_bytes();(repo/'web/deploy/run-public-data.py').write_bytes(runner)
 (repo/'.gitignore').write_text('bank/ignored.mjs\n')
 deps=root/'dependencies';deps.mkdir();(repo/'node_modules').symlink_to(deps,target_is_directory=True)
 for name,version in [('bs58','6.0.0'),('@solana/web3.js','1.98.4'),('@noble/hashes','1.8.0')]:
  pkg=deps/name;pkg.mkdir(parents=True)
  (pkg/'package.json').write_text(json.dumps({'name':name,'version':version,'type':'module','exports':{'./sha2':'./index.mjs'} if name=='@noble/hashes' else './index.mjs'}))
  (pkg/'index.mjs').write_text('export default {encode:()=>"fixture"}\n')
 for name in ['check-public-data-dependencies.mjs','public-data-dependencies.json']:(repo/'web/deploy'/name).write_bytes((ROOT/'web/deploy'/name).read_bytes())
 (repo/'bank/public-data.mjs').write_text('console.log("FIXTURE_REFRESH_RAN")\n')
 fixtures=['bank/vault-index.mjs','bank/governance-index.mjs','web/meta/generate.mjs']
 for name in fixtures:(repo/name).write_text('export const fixture = true\n')
 def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL,text=True).strip()
 git('init');git('add','--','web/deploy','.gitignore','node_modules','bank/public-data.mjs',*fixtures);git('-c','user.name=Guard Test','-c','user.email=guard@example.invalid','commit','-m','Fixture')
 commit=git('rev-parse','HEAD');new=root/commit;repo.rename(new);repo=new
 def check():return subprocess.run(['python3',str(repo/'web/deploy/run-public-data.py'),'--check'],capture_output=True,text=True).returncode
 assert check()==0;print('ok clean commit with resolving runtime imports accepted')
 (repo/'unreviewed').write_text('x');assert check()!=0;(repo/'unreviewed').unlink();print('ok untracked source refused')
 (repo/'bank/ignored.mjs').write_text('x');assert check()!=0;(repo/'bank/ignored.mjs').unlink();print('ok ignored source refused')
 (repo/'web/deploy/run-public-data.py').write_bytes(runner+b'\n# unreviewed\n');assert check()!=0;(repo/'web/deploy/run-public-data.py').write_bytes(runner);print('ok modified source refused')
 pkg=deps/'bs58/package.json';original=pkg.read_text();changed=json.loads(original);changed['version']='0.0.0';pkg.write_text(json.dumps(changed))
 assert check()!=0;print('ok dependency version drift refuses preflight')
 result=subprocess.run(['python3',str(repo/'web/deploy/run-public-data.py')],capture_output=True,text=True)
 assert result.returncode!=0 and 'FIXTURE_REFRESH_RAN' not in result.stdout and 'dependencies differ' in result.stderr
 print('ok dependency version drift refuses an ordinary timer refresh')
 pkg.unlink();assert check()!=0;pkg.write_text(original);assert check()==0
 print('ok missing dependency metadata refuses refresh')
 bad=root/'wrong';repo.rename(bad);repo=bad;assert check()!=0;print('ok wrong commit directory refused')
print('public-data deployment: 17/17 passed')
