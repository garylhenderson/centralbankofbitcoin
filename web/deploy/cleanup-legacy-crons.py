#!/usr/bin/env python3
"""Remove one missing v5 payout job and keep Notice auth out of process argv.
Credentials/crontab bytes go only to a new private backup. No HTTP job is run.
"""
import hashlib, json, os, pathlib, re, stat, subprocess, sys, tempfile
ROOT=pathlib.Path('/opt/cbob-vaults')
def check(ok,message):
 if not ok:raise ValueError(message)
def transform(raw):
 rows=raw.splitlines(keepends=True);remove=[];replace=[]
 for i,line in enumerate(rows):
  if not line.strip() or line.lstrip().startswith('#'):continue
  if '/opt/cbob-vaults' in line and 'bank/distribute.mjs' in line:
   check(re.match(r'^7 9 \* \* \*\s',line) is not None,'Unexpected legacy payout schedule')
   remove.append(i)
  if '/api/cron/cbob-reconcile' in line:
   check(re.match(r'^8 \* \* \* \*\s',line) is not None,'Unexpected Notice schedule')
   check('http://localhost:3003/api/cron/cbob-reconcile' in line and 'curl ' in line and 'Authorization: Bearer ' in line and '/opt/gary-club/.env.local' in line,'Unexpected Notice caller')
   replace.append(i)
 check(len(remove)==1 and len(replace)==1,'Expected exactly one legacy payout and one Notice caller')
 replacement='8 * * * * /usr/bin/node /opt/cbob-vaults/web/deploy/reconcile-notices.mjs >> /var/log/cbob-notice-reconcile.log 2>&1\n'
 return ''.join(replacement if i==replace[0] else line for i,line in enumerate(rows) if i!=remove[0])
def main():
 check(os.getuid()==1000 and len(sys.argv)==3 and sys.argv[1]=='--execute' and re.fullmatch('[a-f0-9]{40}',sys.argv[2]),'Run as ubuntu: cleanup-legacy-crons.py --execute REVIEWED_SHA')
 git=lambda *args:subprocess.check_output(['git','-C',str(ROOT),*args],text=True).strip()
 check(git('rev-parse','HEAD')==sys.argv[2] and git('rev-parse','origin/v6')==sys.argv[2] and not git('status','--porcelain','--untracked-files=all'),'Use clean, reviewed and pushed HEAD')
 check(not (ROOT/'bank/distribute.mjs').exists(),'Legacy payout target exists; do not remove it')
 raw=subprocess.check_output(['crontab','-l'],text=True);updated=transform(raw)
 parent=pathlib.Path('/home/ubuntu/cbob-ecosystem-audit/2026-10-13')
 backup=pathlib.Path(tempfile.mkdtemp(prefix='legacy-crons-',dir=parent));os.chmod(backup,0o700)
 for name,content in [('before.cron',raw),('after.cron',updated)]:
  fd=os.open(backup/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as file:file.write(content)
 log=pathlib.Path('/var/log/cbob-notice-reconcile.log')
 # Do not write logrotate or widen a preexisting file. Refuse unexpected state.
 check(not log.is_symlink(),'Refuse a symlink Notice log before installation')
 if not log.exists():subprocess.run(['sudo','install','-o','ubuntu','-g','ubuntu','-m','600','/dev/null',str(log)],check=True)
 metadata=log.lstat()
 check(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink==1 and metadata.st_uid==1000 and metadata.st_mode&0o077==0,'Unsafe Notice log')
 check(subprocess.check_output(['crontab','-l'],text=True)==raw,'Crontab changed during preparation; no replacement')
 subprocess.run(['crontab',str(backup/'after.cron')],check=True)
 check(subprocess.check_output(['crontab','-l'],text=True)==updated,'Crontab read-back differs; inspect private backup')
 (backup/'receipt.json').write_text(json.dumps({'source_commit':sys.argv[2],'before_sha256':hashlib.sha256(raw.encode()).hexdigest(),'after_sha256':hashlib.sha256(updated.encode()).hexdigest(),'removed_dead_payout':1,'notice_schedule_unchanged':True,'other_lines_unchanged':True,'http_job_invoked':False},indent=2)+'\n')
 print('Removed one dead payout job; Notice schedule retained with private in-process auth. Receipt: '+str(backup/'receipt.json'))
if __name__=='__main__':
 try:main()
 except Exception as error:print(str(error) if isinstance(error,ValueError) else 'Cron cleanup refused; inspect private receipt without printing credentials',file=sys.stderr);sys.exit(1)
