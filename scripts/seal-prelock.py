#!/usr/bin/env python3
"""Freeze a completed receipt; cannot sign, deploy or alter on-chain state."""
import hashlib,os,pathlib,re,shutil,sys,tempfile
FILES=['commit','started','mode','core-before.json','core-after.json','full-suite.log','simulation.log','holder-e2e.log','full-suite.status','simulation.status','holder-e2e.status','result.json']
if os.geteuid()!=0 or len(sys.argv)!=3:raise SystemExit('Called only by the prelock receipt sealer')
source=pathlib.Path(sys.argv[1]);expected=sys.argv[2]
if source.resolve()!=source or source.parent!=pathlib.Path('/opt/cbob-vaults/.cache/prelock') or not re.fullmatch(r'run-[A-Za-z0-9]+',source.name) or not re.fullmatch(r'[a-f0-9]{64}',expected):raise SystemExit('Invalid receipt source or digest')
contents={}
for name in FILES:
 file=source/name
 if file.is_symlink() or not file.is_file():raise SystemExit('Receipt file is missing or redirected')
 contents[name]=file.read_bytes()
digest=hashlib.sha256(''.join(name+'\0'+hashlib.sha256(contents[name]).hexdigest()+'\n' for name in FILES).encode()).hexdigest()
if digest!=expected:raise SystemExit('Receipt changed before archival')
if contents['mode'].strip()!=b'certification':raise SystemExit('Rehearsal cannot be archived as certification')
parent=pathlib.Path('/var/lib/cbob-prelock');parent.mkdir(mode=0o755,exist_ok=True)
if parent.is_symlink() or parent.stat().st_uid!=0 or parent.stat().st_mode&0o022:raise SystemExit('Unsafe archive parent')
target=parent/source.name
if target.exists():raise SystemExit('Never overwrite a certified receipt')
stage=pathlib.Path(tempfile.mkdtemp(prefix='.sealing-',dir=parent))
try:
 for name,data in contents.items():
  file=stage/name;file.write_bytes(data);os.chown(file,0,__import__('grp').getgrnam('ubuntu').gr_gid);file.chmod(0o440)
 os.chown(stage,0,__import__('grp').getgrnam('ubuntu').gr_gid);stage.chmod(0o550);stage.rename(target)
 print('Certified evidence archived at '+str(target))
finally:
 if stage.exists():shutil.rmtree(stage)
