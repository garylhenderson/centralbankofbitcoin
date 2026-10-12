#!/usr/bin/env python3
"""Install or restore the RPC configuration. Secret values never enter output."""
import datetime, json, os, pathlib, pwd, re, shutil, stat, subprocess, sys, tempfile
ROOT=pathlib.Path('/opt/cbob-vaults')
BACKUPS=pathlib.Path('/var/backups/cbob-rpc')
ENV=pathlib.Path('/etc/cbob/rpc-proxy.env')
def check_directory(path):
 metadata=path.lstat()
 if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid!=0 or metadata.st_mode&0o022:
  raise ValueError('Configuration directory must be root-owned without group or public writes')
def check_layout(layout):
 ubuntu=pwd.getpwnam('ubuntu')
 if layout not in {(0,ubuntu.pw_gid,0o640),(ubuntu.pw_uid,ubuntu.pw_gid,0o600)}:
  raise ValueError('Relay environment must be root:ubuntu 0640 or ubuntu:ubuntu 0600')
def read_relay_environment(path):
 # The signing service uses root:ubuntu 0640; keep the earlier ubuntu-only
 # 0600 layout readable during upgrades. Neither layout permits group writes.
 check_directory(path.parent)
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK)
 with os.fdopen(fd,'r',encoding='utf-8',newline='') as file:
  metadata=os.fstat(file.fileno())
  layout=(metadata.st_uid,metadata.st_gid,stat.S_IMODE(metadata.st_mode))
  if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink!=1:
   raise ValueError('Relay environment must be a regular file with one link')
  check_layout(layout)
  if layout[0]!=0:print('Legacy relay ownership retained; signing requires root ownership.',file=sys.stderr)
  try:return file.read(),layout
  except UnicodeDecodeError:raise ValueError('Relay environment is not valid UTF-8') from None
def candidate(original,block):
 marker='    server_name centralbankofbitcoin.com;'
 if original.count(marker)!=1:raise ValueError('Expected exactly one canonical TLS server')
 at=original.index(marker);start=original.rfind('server {',0,at)
 if start<0 or not re.search(r'^\s*listen\s+(?:\S+:)?443\b',original[start:at],re.M):raise ValueError('Canonical server must declare TLS before server_name')
 if re.search(r'location\s*=\s*/rpc\s*\{',original):raise ValueError('RPC location already exists; inspect it instead of overwriting it')
 return original.replace(marker,marker+'\n\n    # CBOB committed RPC relay\n'+block,1)
def atomic(path,content,layout=None):
 try:metadata=path.lstat()
 except FileNotFoundError:metadata=None
 if metadata and (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink!=1):
  raise ValueError('Configuration target must be a regular file with one link')
 if layout is None:layout=(metadata.st_uid,metadata.st_gid,stat.S_IMODE(metadata.st_mode)) if metadata else (0,0,0o644)
 fd,name=tempfile.mkstemp(prefix='.cbob-rpc-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(content if isinstance(content,bytes) else content.encode('utf-8'));f.flush();os.fsync(f.fileno())
  os.chown(name,layout[0],layout[1]);os.chmod(name,layout[2])
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)
def restore(backup):
 if backup.parent!=BACKUPS:raise ValueError('Unknown RPC backup directory')
 check_directory(backup.parent);check_directory(backup)
 for item in json.loads((backup/'manifest.json').read_text()):
  p=pathlib.Path(item['path'])
  if item['existed']:
   layout=(item['uid'],item['gid'],item['mode'])
   if p==ENV:check_directory(p.parent);check_layout(layout)
   atomic(p,(backup/p.name).read_bytes(),layout)
  elif p.exists():p.unlink()
def main():
 if os.geteuid()!=0:raise ValueError('Root required for nginx configuration')
 check_directory(ENV.parent)
 if len(sys.argv)==3 and sys.argv[1]=='--restore':restore(pathlib.Path(sys.argv[2]).resolve());return
 if len(sys.argv)!=3 or sys.argv[2]!='--execute':raise ValueError('Pass collection and --execute after review')
 collection=sys.argv[1]
 if not re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}',collection):raise ValueError('Invalid collection')
 ng=pathlib.Path('/etc/nginx/sites-enabled/centralbankofbitcoin').resolve();zone=pathlib.Path('/etc/nginx/conf.d/cbob-rpc-zone.conf');env=ENV
 block=(ROOT/'web/deploy/nginx-rpc.conf').read_bytes().decode('utf-8').split('location = /rpc {',1)[1]
 if block.count('{')!=1 or block.count('}')!=2:raise ValueError('Unexpected RPC block shape')
 block='location = /rpc {'+block
 old=ng.read_bytes().decode('utf-8');new=old if '# CBOB committed RPC relay\n'+block in old else candidate(old,block)
 content,env_layout=read_relay_environment(env);values={}
 for key,value in re.findall(r'^\s*(?:export\s+)?(CBOB_\w+)\s*=\s*(.*?)\s*$',content,re.M):
  if key in values:raise ValueError('Duplicate relay configuration key')
  values[key]=value.strip('\"\'')
 if values.get('CBOB_DAS_UPSTREAM') and not values['CBOB_DAS_UPSTREAM'].startswith('https://'):raise ValueError('DAS upstream must use HTTPS')
 if not values.get('CBOB_RPC_UPSTREAM','').startswith('https://') or values.get('CBOB_RPC_ORIGIN')!='https://centralbankofbitcoin.com' or values.get('CBOB_RPC_PORT')!='8789':raise ValueError('Relay upstream, origin or port configuration is invalid')
 if values.get('CBOB_VAULT_COLLECTION',collection)!=collection:raise ValueError('Existing relay collection differs')
 newenv=content if 'CBOB_VAULT_COLLECTION' in values else content.rstrip()+'\nCBOB_VAULT_COLLECTION='+collection+'\n'
 z='limit_req_zone $binary_remote_addr zone=cbob_rpc:10m rate=10r/s;\n'
 if zone.exists() and zone.read_bytes()!=z.encode('utf-8'):raise ValueError('Existing RPC zone differs; inspect before changing')
 expanded=subprocess.run(['nginx','-T'],capture_output=True,text=True,check=True).stdout
 if not re.search(r'^\s*real_ip_header\s+CF-Connecting-IP;',expanded,re.M) or not re.search(r'^\s*set_real_ip_from\s+',expanded,re.M):raise ValueError('Cloudflare real-IP configuration is required')
 parent=BACKUPS;parent.mkdir(exist_ok=True,mode=0o700);check_directory(parent)
 backup=pathlib.Path(tempfile.mkdtemp(prefix='config-',dir=parent));os.chmod(backup,0o700)
 files=[ng,zone,env];rows=[]
 for p in files:
  metadata=p.lstat() if p.exists() or p.is_symlink() else None
  if metadata and (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink!=1):raise ValueError('Configuration backup target must be a regular file with one link')
  rows.append({'path':str(p),'existed':metadata is not None,'mode':stat.S_IMODE(metadata.st_mode) if metadata else None,'uid':metadata.st_uid if metadata else None,'gid':metadata.st_gid if metadata else None})
  if p.exists():shutil.copy2(p,backup/p.name)
 (backup/'manifest.json').write_text(json.dumps(rows))
 try:
  for p,updated in [(ng,new),(zone,z),(env,newenv)]:
   # atomic preserves the validated file's uid/gid/mode, including group read
   # for the unprivileged public-data job. Never downgrade 0640 to 0600 here.
   if not p.exists() or p.read_bytes()!=updated.encode('utf-8'):atomic(p,updated,env_layout if p==env else None)
  subprocess.run(['nginx','-t'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 except Exception:
  restore(backup);raise ValueError('Configuration rejected; original files restored') from None
 print(backup)
if __name__=='__main__':
 try:main()
 except Exception as e:print('RPC configuration refused: '+('Invalid UTF-8 configuration' if isinstance(e,UnicodeDecodeError) else str(e) if isinstance(e,ValueError) else type(e).__name__),file=sys.stderr);sys.exit(1)
