#!/usr/bin/env python3
"""Root-only real systemd namespace and timeout fixtures. No real credentials."""
import importlib.util, json, os, pathlib, pwd, subprocess, sys, tempfile
sys.dont_write_bytecode=True
if os.geteuid()!=0:raise SystemExit('Run with sudo; only disposable fixture files are written.')
ROOT=pathlib.Path(__file__).resolve().parents[2]
user=pwd.getpwnam('nobody')
spec=importlib.util.spec_from_file_location('activation',ROOT/'web/deploy/activate-public-data.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
with tempfile.TemporaryDirectory(prefix='cbob-isolation-fixture-',dir='/run') as tmp:
 root=pathlib.Path(tmp);os.chmod(root,0o755)
 for name in ['bank/.git','cache','gary/node_modules','gary/scripts','output/data','output/v','state','ceremony','backups']:(root/name).mkdir(parents=True,exist_ok=True)
 for name in ['bank','cache','gary','ceremony','backups']:(root/name/'secret').write_text('world-readable fixture must be hidden')
 (root/'bank/.cache').symlink_to(root/'cache')
 (root/'cache/public-data.flock').touch();os.chmod(root/'cache/public-data.flock',0o666)
 (root/'gary/.env.local').write_text('WALLET_KEY=must-not-be-visible\n');os.chmod(root/'gary/.env.local',0o600)
 (root/'gary/node_modules/fixture').write_text('library')
 (root/'gary/scripts/cbob-reconcile.mjs').write_text('// fixture script')
 (root/'bank/.git/fixture').write_text('git')
 for kind in ['public','reconcile']:
  narrow=root/(kind+'.env');narrow.write_text('READ_KEY='+kind+'\n');os.chown(narrow,0,user.pw_gid);os.chmod(narrow,0o640)
 for name in ['output/data','output/v','state']:os.chown(root/name,user.pw_uid,user.pw_gid)
 mapping={'/opt/gary-club':root/'gary','/opt/cbob-vaults':root/'bank','/scratch/cbob-vaults-cache':root/'cache','/etc/cbob/public-data-reader.env':root/'public.env','/etc/cbob/reconcile-reader.env':root/'reconcile.env','/var/www/centralbankofbitcoin':root/'output','/var/lib/cbob-public-data':root/'state','/opt/cbob-ceremony':root/'ceremony','/var/backups':root/'backups'}
 inode=(root/'cache/public-data.flock').stat().st_ino
 script=root/'probe.py';script.write_text('''import json,os,pathlib,sys,fcntl
root=pathlib.Path(__file__).parent;kind=sys.argv[1]
checks={'uid':os.getuid()!=0,'no_extra_groups':set(os.getgroups())<=set([os.getgid()]),'limited_environment':(root/'gary/.env.local').read_text()=='READ_KEY='+kind+'\\n'}
for name in ['bank','cache','gary','ceremony','backups']:
 try:(root/name/'secret').read_text();checks[name+'_hidden']=False
 except OSError:checks[name+'_hidden']=True
try:pathlib.Path('/home/ubuntu/.claude').stat();checks['home_hidden']=False
except OSError:checks['home_hidden']=True
try:(root/'output/data/probe').write_text('ok');checks['output_scope']=kind=='public'
except OSError:checks['output_scope']=kind=='reconcile'
if kind=='public':
 with (root/'bank/.cache/public-data.flock').open('a') as f:
  fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  checks['same_lock_inode']=os.fstat(f.fileno()).st_ino==int(sys.argv[2])
 checks['libraries_readable']=(root/'gary/node_modules/fixture').read_text()=='library'
 checks['git_readable']=(root/'bank/.git/fixture').read_text()=='git'
else:checks['caller_readable']=(root/'gary/scripts/cbob-reconcile.mjs').read_text()=='// fixture script'
print(json.dumps(checks));raise SystemExit(0 if all(checks.values()) else 1)
''')
 for kind,template in [('public','public-data-isolation.conf'),('reconcile','reconcile-isolation.conf')]:
  properties=[]
  for line in (ROOT/'web/deploy'/template).read_text().splitlines():
   if not line or line.startswith('['):continue
   if line.startswith('User='):line='User=nobody'
   elif line.startswith('Group='):line='Group=nogroup'
   for old,new in sorted(mapping.items(),key=lambda x:-len(x[0])):line=line.replace(old,str(new))
   properties.append('--property='+line)
  result=subprocess.run(['systemd-run','--quiet','--wait','--pipe','--collect',*properties,'--property=RuntimeMaxSec=10','/usr/bin/python3','-I',str(script),kind,str(inode)],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=20)
  if result.returncode:
   print(result.stderr);print(result.stdout);raise SystemExit('Sandbox fixture refused')
  checks=json.loads(result.stdout);assert all(checks.values())
  print(json.dumps({'kind':kind,'checks':checks,'ok':True}))
 assert (root/'gary/.env.local').read_text()=='WALLET_KEY=must-not-be-visible\n'
 print('ok original host credential fixture unchanged')
 # Real named transient must die before a first-refresh timeout returns. Its
 # RuntimeMaxSec is deliberately longer than the outer deadline in this test.
 child=root/'child.py';pidfile=root/'state/pids.json'
 child.write_text('import json,os,pathlib,subprocess,sys,time\np=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"])\npathlib.Path('+repr(str(pidfile))+').write_text(json.dumps([os.getpid(),p.pid]))\ntime.sleep(60)\n')
 try:a.run_isolated_refresh(['/usr/bin/python3','-I',str(child)],root,['User=nobody','Group=nogroup'],timeout=1,runtime=20)
 except RuntimeError as error:assert not isinstance(error,a.RefreshStillRunning)
 else:raise AssertionError('Timeout accepted')
 for pid in json.loads(pidfile.read_text()):
  state=pathlib.Path('/proc')/str(pid)/'stat'
  assert not state.exists() or state.read_text().rsplit(') ',1)[1].split()[0]=='Z','Transient descendant survived timeout'
 print('ok real timeout stops the transient and all descendants before returning')
