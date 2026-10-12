"""Exercise the real shell wrapper in a temporary sandbox with inert commands."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

STUB='''#!/usr/bin/python3
import json,os,pathlib,sys
name=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
root=pathlib.Path(os.environ['FIXTURE_ROOT'])
with (root/'calls').open('a') as log:log.write(json.dumps([name,args])+"\\n")
scenario=os.environ['SCENARIO']
if name=='id':print('ubuntu')
elif name=='git':
 if args[:2]==['rev-parse','HEAD']:print('fixture-commit')
 elif args[:2]==['status','--porcelain'] and (root/'dirty').exists():print(' M changed')
elif name=='node':
 if args==['--input-type=module','-']:sys.stdin.read();print('11111111111111111111111111111111')
 elif '--direct' in args and scenario in ('running','stopped','absent','restore-fails'):sys.exit(1)
elif name=='pm2':
 if pathlib.Path('/proc/self/fd/8').exists():sys.exit(91)
 if args[0]=='pid':print('123' if scenario=='running' else '0')
 if args[0]=='describe' and scenario=='absent':sys.exit(1)
elif name=='sudo':
 if 'configure-rpc.py' in ' '.join(args):
  if '--execute' in args:
   print('/fixture/backup')
   if scenario=='source-change':(root/'dirty').touch()
  elif '--restore' in args and scenario=='restore-fails':sys.exit(1)
elif name=='bash':
 if '--execute' in args and scenario=='publish-fails':sys.exit(1)
sys.exit(0)
'''

class ReleaseWrapperTests(unittest.TestCase):
 def run_fixture(self,scenario):
  with tempfile.TemporaryDirectory(prefix='cbob-release-wrapper-') as temp:
   root=Path(temp);bin_dir=root/'bin';bin_dir.mkdir()
   for command in ('id','git','node','pm2','sudo','bash','sleep'):
    path=bin_dir/command;path.write_text(STUB);path.chmod(0o755)
   source=Path(__file__).with_name('go-live.sh').read_text()
   # Only relocate the fixed production directory. All shell control flow is
   # the checked-in script; no production commands or configuration are used.
   script=root/'go-live.sh';script.write_text(source.replace('/opt/cbob-vaults',str(root)))
   env={'PATH':str(bin_dir)+':/usr/bin:/bin','FIXTURE_ROOT':str(root),'SCENARIO':scenario}
   result=subprocess.run(['/bin/bash',str(script),'--execute','fixture-commit'],env=env,text=True,capture_output=True,timeout=15)
   calls=[json.loads(line) for line in (root/'calls').read_text().splitlines()]
   return result,calls
 def test_running_stopped_and_absent_rollback(self):
  for scenario,expected in [('running','restart'),('stopped','stop'),('absent','delete')]:
   with self.subTest(scenario=scenario):
    result,calls=self.run_fixture(scenario)
    self.assertEqual(result.returncode,1)
    self.assertTrue(any(name=='sudo' and '--restore' in args for name,args in calls))
    self.assertIn(['pm2',[expected,'cbob-rpc-proxy']],calls)
    self.assertIn(['pm2',['save']],calls)
    self.assertIn('Published pages and source code were not rolled back',result.stderr)
 def test_changed_source_never_executes_root_restore(self):
  result,calls=self.run_fixture('source-change')
  self.assertEqual(result.returncode,1)
  self.assertFalse(any(name=='sudo' and '--restore' in args for name,args in calls))
  self.assertIn('refusing root restore',result.stderr)
 def test_restore_failure_does_not_skip_remaining_recovery(self):
  result,calls=self.run_fixture('restore-fails')
  self.assertEqual(result.returncode,1)
  self.assertIn('Configuration restore failed',result.stderr)
  self.assertIn(['pm2',['stop','cbob-rpc-proxy']],calls)
  self.assertIn(['sudo',['systemctl','reload','nginx']],calls)
 def test_publication_failure_retains_saved_healthy_relay(self):
  result,calls=self.run_fixture('publish-fails')
  self.assertEqual(result.returncode,1)
  self.assertFalse(any(name=='sudo' and '--restore' in args for name,args in calls))
  saved=calls.index(['pm2',['save']])
  published=next(i for i,(name,args) in enumerate(calls) if name=='bash' and '--execute' in args)
  self.assertLess(saved,published)
 def test_success_and_pm2_has_no_inherited_deployment_lock(self):
  result,calls=self.run_fixture('success')
  self.assertEqual(result.returncode,0,result.stderr)
  self.assertIn('Public relay and pages checked',result.stdout)
  self.assertFalse(any(name=='sudo' and '--restore' in args for name,args in calls))

if __name__=='__main__':unittest.main()
