#!/usr/bin/env python3
"""Narrow, backed-up A5 migration. No secrets printed; no timer newly enabled.

Run --execute REVIEWED_SHA after committing, pushing and pinning that producer.
The existing jobs must be successful, idle and already scheduled. Failure
restores their exact prior drop-ins and schedule; new limited identities and
private credentials are retained for diagnosis, never a reason to retry blind.
"""
import fcntl, grp, hashlib, json, os, pathlib, pwd, re, shutil, stat, subprocess, sys, tempfile, time

ROOT=pathlib.Path('/opt/cbob-vaults')
STATE=pathlib.Path('/var/lib/cbob-public-data')
JOBS={'cbob-public-data':('cbob-data','public-data-isolation.conf','public-data-reader.env'),
      'cbob-reconcile':('cbob-reconcile','reconcile-isolation.conf','reconcile-reader.env')}
PUBLIC_KEYS={'HELIUS_RPC_URL','SDN_GATEWAY_KEY','SDN_GATEWAY_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CBOB_PORTAL_TRADING_ENABLED'}
REQUIRED={'HELIUS_RPC_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'}
CALLER_SHA256='af31aca969ae21acc2fc2fd32212c1a20958e91f5c833b4c46383b4be18ff785'

def call(*args):
 return subprocess.check_output(args,text=True,stderr=subprocess.DEVNULL).strip()
def check(ok,message):
 if not ok: raise ValueError(message)
def normal(path,directory=False):
 s=path.lstat()
 check(stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode),'Unexpected path type')
 if not directory: check(s.st_nlink==1,'Unexpected hard link')
 return s
def select_env(raw,keys,required):
 rows={}
 for line in raw.splitlines():
  m=re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)',line)
  if m and m[1] in keys:
   check(m[1] not in rows,'Duplicate scoped configuration key')
   check(m[2].strip().strip('\"\''),'Empty scoped configuration key')
   rows[m[1]]=line
 check(required<=rows.keys(),'Missing scoped configuration')
 return ('\n'.join(rows[k] for k in sorted(rows))+'\n').encode()
def atomic(path,data,uid=0,gid=0,mode=0o644):
 if path.exists() or path.is_symlink(): normal(path)
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='.cbob-isolation-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f: f.write(data);f.flush();os.fsync(f.fileno())
  os.chown(tmp,uid,gid);os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def controlled_tree(root,uid,gid,dir_mode,file_mode):
 # Validate the entire tree before changing any ownership, including symlinks.
 entries=[root,*root.rglob('*')]
 for p in entries:
  s=p.lstat();check(stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode),'Unexpected state path')
  if stat.S_ISREG(s.st_mode):check(s.st_nlink==1,'Unexpected state hard link')
 for p in entries:
  os.chown(p,uid,gid);os.chmod(p,dir_mode if p.is_dir() else file_mode)
def ensure_identity(name):
 try: member=pwd.getpwnam(name)
 except KeyError:
  subprocess.run(['useradd','--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',name],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  member=pwd.getpwnam(name)
 check(member.pw_uid!=0 and member.pw_dir=='/nonexistent' and member.pw_shell=='/usr/sbin/nologin','Unexpected service identity')
 check(grp.getgrgid(member.pw_gid).gr_name==name and os.getgrouplist(name,member.pw_gid)==[member.pw_gid],'Unexpected service groups')
 return member
def wait_idle(jobs,seconds=490):
 until=time.monotonic()+seconds
 while any(call('systemctl','show',j+'.service','--property=ActiveState','--value') in ('active','activating','deactivating') for j in jobs):
  check(time.monotonic()<until,'Jobs did not become idle; no process was killed')
  time.sleep(1)

def main():
 check(os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1]=='--execute' and re.fullmatch('[a-f0-9]{40}',sys.argv[2]),'Usage: sudo python3 -I install-job-isolation.py --execute REVIEWED_SHA')
 commit=sys.argv[2]
 git=lambda *args:call('git','-c','safe.directory='+str(ROOT),'-C',str(ROOT),*args)
 check(git('rev-parse','HEAD')==commit and not git('status','--porcelain','--untracked-files=all'),'Source must be clean at reviewed HEAD')
 check(git('rev-parse','origin/v6')==commit,'Push reviewed HEAD first')
 check((ROOT/'.cache').resolve()==pathlib.Path('/scratch/cbob-vaults-cache'),'Unexpected cache and lock layout')
 caller=pathlib.Path('/opt/gary-club/scripts/cbob-reconcile.mjs');normal(caller)
 check(hashlib.sha256(caller.read_bytes()).hexdigest()==CALLER_SHA256,'Recovery caller differs from reviewed bytes')
 check(pathlib.Path(__file__).resolve()==ROOT/'web/deploy/install-job-isolation.py','Run the committed installer')
 pinned=pathlib.Path('/etc/systemd/system/cbob-public-data.service.d/50-reviewed-source.conf').read_text()
 check('WorkingDirectory=/opt/cbob-public-data/'+commit+'\n' in pinned,'Pin the reviewed producer first')
 check(not STATE.exists(),'State destination exists; inspect prior attempt, never replay blind')
 for j in JOBS:
  check(call('systemctl','is-active',j+'.timer')=='active','Existing timer is not active')
  check(call('systemctl','show',j+'.service','--property=Result','--value')=='success','Existing job is not healthy')
  check(not pathlib.Path('/etc/systemd/system/'+j+'.service.d/90-isolation.conf').exists(),'Isolation already installed; inspect it')
 env=pathlib.Path('/opt/gary-club/.env.local');s=normal(env)
 check(s.st_uid==pwd.getpwnam('ubuntu').pw_uid and stat.S_IMODE(s.st_mode)==0o600,'Unexpected source environment permissions')
 raw=env.read_text()
 for flag in ['CBOB_PORTAL_HOLDER_ACTIONS_ENABLED','CBOB_PORTAL_TRADING_ENABLED']:
  values=re.findall('^'+flag+'=(.*)$',raw,re.M)
  check(len(values)<=1 and (not values or values[0].strip().strip('\"\'')!='1'),'Keep both release switches off during isolation')
 # Capture PM2 privately, never print its credential-bearing JSON.
 apps=json.loads(call('runuser','-u','ubuntu','--','pm2','jlist'))
 live=[app.get('pm2_env',{}) for app in apps if app.get('name')=='gary-club']
 check(len(live)==1 and live[0].get('status')=='online','Expected one running Gary Club process')
 check(all(live[0].get(flag)!='1' and live[0].get('env',{}).get(flag)!='1' for flag in ['CBOB_PORTAL_HOLDER_ACTIONS_ENABLED','CBOB_PORTAL_TRADING_ENABLED']),'Running release switches must also be off')
 scoped={'cbob-public-data':select_env(raw,PUBLIC_KEYS,REQUIRED),'cbob-reconcile':select_env(raw,{'CRON_SECRET'},{'CRON_SECRET'})}
 directory=pathlib.Path('/etc/cbob');d=normal(directory,True)
 check(d.st_uid==0 and not d.st_mode&0o022,'Unexpected configuration directory permissions')
 for _,(_,_,name) in JOBS.items():check(not (directory/name).exists(),'Scoped credential already exists; inspect prior attempt')
 backups=pathlib.Path('/var/backups/cbob-job-isolation');backups.mkdir(mode=0o700,exist_ok=True)
 b=normal(backups,True);check(b.st_uid==0 and stat.S_IMODE(b.st_mode)==0o700,'Unsafe backup directory')
 backup=pathlib.Path(tempfile.mkdtemp(prefix='migration-',dir=backups))
 receipt={'source_commit':commit,'status':'preparing','timers_previously_active':list(JOBS)}
 def record():atomic(backup/'receipt.json',(json.dumps(receipt,indent=2)+'\n').encode(),mode=0o600)
 record();paused=[];installed=[];resume=True
 try:
  for j in JOBS:subprocess.run(['systemctl','stop',j+'.timer'],check=True);paused.append(j)
  wait_idle(JOBS)
  with open('/opt/cbob-vaults/.cache/public-data.flock','a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   members={j:ensure_identity(info[0]) for j,info in JOBS.items()}
   data=members['cbob-public-data'];operator=pwd.getpwnam('ubuntu')
   STATE.mkdir(mode=0o750)
   for name in ['vault-index','vault-meta-state.json','market-sale-times.json']:
    old=pathlib.Path('/opt/cbob-vaults/.cache')/name
    if old.exists():
     if old.is_dir():
      for entry in [old,*old.rglob('*')]:normal(entry,entry.is_dir())
      shutil.copytree(old,STATE/name)
     else:normal(old);shutil.copy2(old,STATE/name)
   controlled_tree(STATE,data.pw_uid,data.pw_gid,0o750,0o640)
   for name in ['data','v']:
    p=pathlib.Path('/var/www/centralbankofbitcoin')/name
    controlled_tree(p,operator.pw_uid,data.pw_gid,0o2775,0o664)
   normal(pathlib.Path(lock.name));os.fchown(lock.fileno(),operator.pw_uid,data.pw_gid);os.fchmod(lock.fileno(),0o660)
   for j,(user,template,filename) in JOBS.items():
    atomic(directory/filename,scoped[j],gid=members[j].pw_gid,mode=0o640)
    dest=pathlib.Path('/etc/systemd/system/'+j+'.service.d/90-isolation.conf')
    content=(ROOT/'web/deploy'/template).read_bytes()
    installed.append(dest);atomic(dest,content)
    receipt[j]={'uid':members[j].pw_uid,'template_sha256':hashlib.sha256(content).hexdigest(),'allowed_credential_names':sorted(PUBLIC_KEYS if j=='cbob-public-data' else ['CRON_SECRET'])}
   subprocess.run(['systemctl','daemon-reload'],check=True)
  # The ordinary services take their normal locks and run with their actual
  # mounts/credentials. No synthetic email, member, order or signature is made.
  for j in JOBS:
   subprocess.run(['systemctl','start',j+'.service'],check=True,timeout=500,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   check(call('systemctl','show',j+'.service','--property=Result','--value')=='success','Isolated job did not succeed')
  receipt['status']='installed';record()
 except Exception:
  receipt['status']='failed';record()
  try:
   for p in installed:
    if p.exists():p.unlink()
   subprocess.run(['systemctl','daemon-reload'],check=True)
   receipt['rollback']='prior unit definitions restored';record()
  except Exception:
   resume=False
   receipt['rollback']='FAILED: inspect unit state';record()
   raise RuntimeError('Isolation and unit restoration failed; inspect private receipt') from None
  raise RuntimeError('Isolation refused or failed; prior unit definitions restored; inspect private receipt before retrying') from None
 finally:
  # Resume only schedules observed active before this migration.
  if resume:
   for j in paused:subprocess.run(['systemctl','start',j+'.timer'],check=True)
 print('Both jobs isolated and healthy; existing timers resumed. Receipt: '+str(backup/'receipt.json'))

if __name__=='__main__':
 try:main()
 except Exception as error:
  print(str(error) if isinstance(error,(ValueError,RuntimeError)) else 'Isolation refused; inspect private receipt and service status without dumping credentials',file=sys.stderr);sys.exit(1)
