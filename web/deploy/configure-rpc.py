#!/usr/bin/env python3
"""Install or restore the RPC configuration. Secret values never enter output."""
import datetime, json, os, pathlib, pwd, re, shutil, subprocess, sys, tempfile
ROOT=pathlib.Path('/opt/cbob-vaults')
def candidate(original,block):
 marker='    server_name centralbankofbitcoin.com;'
 if original.count(marker)!=1:raise ValueError('Expected exactly one canonical TLS server')
 at=original.index(marker);start=original.rfind('server {',0,at)
 if start<0 or not re.search(r'^\s*listen\s+(?:\S+:)?443\b',original[start:at],re.M):raise ValueError('Canonical server must declare TLS before server_name')
 if re.search(r'location\s*=\s*/rpc\s*\{',original):raise ValueError('RPC location already exists; inspect it instead of overwriting it')
 return original.replace(marker,marker+'\n\n    # CBOB committed RPC relay\n'+block,1)
def atomic(path,content,mode=None):
 fd,name=tempfile.mkstemp(prefix='.cbob-rpc-',dir=path.parent)
 try:
  with os.fdopen(fd,'w') as f:f.write(content);f.flush();os.fsync(f.fileno())
  if path.exists():
   st=path.stat();os.chown(name,st.st_uid,st.st_gid);os.chmod(name,mode or (st.st_mode&0o777))
  else:os.chmod(name,mode or 0o644)
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)
def restore(backup):
 if backup.parent!=pathlib.Path('/var/backups/cbob-rpc'):raise ValueError('Unknown RPC backup directory')
 for item in json.loads((backup/'manifest.json').read_text()):
  p=pathlib.Path(item['path'])
  if item['existed']:atomic(p,(backup/p.name).read_text(),item['mode'])
  elif p.exists():p.unlink()
def main():
 if os.geteuid()!=0:raise ValueError('Root required for nginx configuration')
 if len(sys.argv)==3 and sys.argv[1]=='--restore':restore(pathlib.Path(sys.argv[2]).resolve());return
 if len(sys.argv)!=3 or sys.argv[2]!='--execute':raise ValueError('Pass collection and --execute after review')
 collection=sys.argv[1]
 if not re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}',collection):raise ValueError('Invalid collection')
 ng=pathlib.Path('/etc/nginx/sites-enabled/centralbankofbitcoin').resolve();zone=pathlib.Path('/etc/nginx/conf.d/cbob-rpc-zone.conf');env=pathlib.Path('/etc/cbob/rpc-proxy.env')
 block=(ROOT/'web/deploy/nginx-rpc.conf').read_text().split('location = /rpc {',1)[1]
 if block.count('{')!=1 or block.count('}')!=2:raise ValueError('Unexpected RPC block shape')
 block='location = /rpc {'+block
 old=ng.read_text();new=old if '# CBOB committed RPC relay\n'+block in old else candidate(old,block)
 content=env.read_text();values={}
 for key,value in re.findall(r'^\s*(?:export\s+)?(CBOB_\w+)\s*=\s*(.*?)\s*$',content,re.M):
  if key in values:raise ValueError('Duplicate relay configuration key')
  values[key]=value.strip('\"\'')
 if env.stat().st_mode&0o077:raise ValueError('Relay environment must be private')
 if values.get('CBOB_DAS_UPSTREAM') and not values['CBOB_DAS_UPSTREAM'].startswith('https://'):raise ValueError('DAS upstream must use HTTPS')
 if env.stat().st_uid!=pwd.getpwnam('ubuntu').pw_uid:raise ValueError('Relay environment must be owned by ubuntu')
 if not values.get('CBOB_RPC_UPSTREAM','').startswith('https://') or values.get('CBOB_RPC_ORIGIN')!='https://centralbankofbitcoin.com' or values.get('CBOB_RPC_PORT')!='8789':raise ValueError('Relay upstream, origin or port configuration is invalid')
 if values.get('CBOB_VAULT_COLLECTION',collection)!=collection:raise ValueError('Existing relay collection differs')
 newenv=content if 'CBOB_VAULT_COLLECTION' in values else content.rstrip()+'\nCBOB_VAULT_COLLECTION='+collection+'\n'
 z='limit_req_zone $binary_remote_addr zone=cbob_rpc:10m rate=10r/s;\n'
 if zone.exists() and zone.read_text()!=z:raise ValueError('Existing RPC zone differs; inspect before changing')
 expanded=subprocess.run(['nginx','-T'],capture_output=True,text=True,check=True).stdout
 if not re.search(r'^\s*real_ip_header\s+CF-Connecting-IP;',expanded,re.M) or not re.search(r'^\s*set_real_ip_from\s+',expanded,re.M):raise ValueError('Cloudflare real-IP configuration is required')
 parent=pathlib.Path('/var/backups/cbob-rpc');parent.mkdir(exist_ok=True,mode=0o700)
 backup=pathlib.Path(tempfile.mkdtemp(prefix='config-',dir=parent));os.chmod(backup,0o700)
 files=[ng,zone,env];rows=[]
 for p in files:
  rows.append({'path':str(p),'existed':p.exists(),'mode':(p.stat().st_mode&0o777) if p.exists() else None})
  if p.exists():shutil.copy2(p,backup/p.name)
 (backup/'manifest.json').write_text(json.dumps(rows))
 try:
  for p,updated in [(ng,new),(zone,z),(env,newenv)]:
   if not p.exists() or p.read_text()!=updated:atomic(p,updated,0o600 if p==env else None)
  subprocess.run(['nginx','-t'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 except Exception:
  restore(backup);raise ValueError('Configuration rejected; original files restored') from None
 print(backup)
if __name__=='__main__':
 try:main()
 except Exception as e:print('RPC configuration refused: '+(str(e) if isinstance(e,ValueError) else type(e).__name__),file=sys.stderr);sys.exit(1)
