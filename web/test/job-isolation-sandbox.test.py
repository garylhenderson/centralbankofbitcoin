#!/usr/bin/env python3
"""Root-only real systemd namespace fixture. No production data or credentials."""
import json, os, pathlib, pwd, subprocess, sys, tempfile
if os.geteuid()!=0:raise SystemExit('Run with sudo; only disposable fixture files are written.')
ROOT=pathlib.Path(__file__).resolve().parents[2]
user=pwd.getpwnam('nobody')
with tempfile.TemporaryDirectory(prefix='cbob-isolation-fixture-',dir='/run') as tmp:
 root=pathlib.Path(tmp);os.chmod(root,0o755)
 narrow=root/'narrow';narrow.write_text('READ_KEY=fixture\n');os.chown(narrow,0,user.pw_gid);os.chmod(narrow,0o640)
 target=root/'app.env';target.write_text('WALLET_KEY=fixture-must-not-be-visible\n');os.chmod(target,0o600)
 output=root/'output';output.mkdir();os.chown(output,user.pw_uid,user.pw_gid)
 denied=root/'readonly';denied.write_text('original');os.chown(denied,user.pw_uid,user.pw_gid);os.chmod(denied,0o666)
 script=root/'probe.py';script.write_text('''import json,os,pathlib
root=pathlib.Path(__file__).parent
checks={'uid':os.getuid()!=0,'no_extra_groups':set(os.getgroups())<=set([os.getgid()]), 'limited_environment':(root/'app.env').read_text()=='READ_KEY=fixture\\n'}
try:(root/'readonly').write_text('wrong');checks['readonly']=False
except OSError:checks['readonly']=True
try:pathlib.Path('/home/ubuntu/.claude').stat();checks['home_hidden']=False
except OSError:checks['home_hidden']=True
(root/'output/proof.json').write_text(json.dumps(checks))
raise SystemExit(0 if all(checks.values()) else 1)
''')
 template=(ROOT/'web/deploy/public-data-isolation.conf').read_text().splitlines()
 properties=[]
 for line in template:
  if not line or line.startswith('['):continue
  key=line.split('=',1)[0]
  if key in ['User','Group','BindReadOnlyPaths','ReadWritePaths','Environment']:continue
  properties.append('--property='+line)
 properties+=['--property=User=nobody','--property=Group=nogroup','--property=BindReadOnlyPaths='+str(narrow)+':'+str(target),'--property=ReadWritePaths='+str(output),'--property=RuntimeMaxSec=10']
 result=subprocess.run(['systemd-run','--quiet','--wait','--pipe','--collect',*properties,'/usr/bin/python3','-I',str(script)],capture_output=True,text=True,timeout=20)
 proof=output/'proof.json'
 if result.returncode or not proof.exists():
  print(result.stderr);print(proof.read_text() if proof.exists() else 'No fixture proof');raise SystemExit('Sandbox fixture refused')
 checks=json.loads(proof.read_text());assert all(checks.values()) and denied.read_text()=='original' and target.read_text().startswith('WALLET_KEY=')
 print(json.dumps({'checks':checks,'host_credentials_unchanged':True,'ok':True}))
