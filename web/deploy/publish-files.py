#!/usr/bin/env python3
"""Publish a prepared tree atomically per file, with an exact reversible manifest."""
import hashlib, json, os, pathlib, shutil, stat, sys, tempfile

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def atomic_copy(source,target):
 target.parent.mkdir(parents=True,exist_ok=True)
 fd,name=tempfile.mkstemp(prefix='.cbob-',dir=target.parent)
 try:
  with os.fdopen(fd,'wb') as f:
   f.write(source.read_bytes()); f.flush(); os.fsync(f.fileno())
  shutil.copystat(source,name)
  if os.geteuid()==0:
   st=source.stat();os.chown(name,st.st_uid,st.st_gid)
  os.replace(name,target)
 finally:
  if os.path.exists(name):os.unlink(name)
def safe(root,rel):
 p=pathlib.PurePosixPath(rel)
 if p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe manifest path')
 dst=root/p
 if any(x.is_symlink() for x in [dst,*dst.parents] if x!=root.parent):raise ValueError('Refusing a symlink destination')
 return dst
def restore(backup):
 info=json.loads((backup/'manifest.json').read_text());site=pathlib.Path(info['site'])
 # Refuse concurrent edits before restoring any file.
 for r in info['files']:
  dst=safe(site,r['path'])
  if dst.exists() and sha(dst) not in [r['installed'],r['previous']]:raise ValueError('A destination changed after publication; inspect it before restoring')
 for r in info['files']:
  dst=safe(site,r['path'])
  if r['previous'] is not None:atomic_copy(backup/'original'/r['path'],dst)
  elif dst.exists():dst.unlink()
def publish(source,site,backup):
 backup.mkdir(mode=0o700,parents=False,exist_ok=False)
 rows=[]
 for src in sorted(source.rglob('*')):
  if src.is_symlink():raise ValueError('Refusing symlink source')
  if not src.is_file():continue
  rel=src.relative_to(source).as_posix();dst=safe(site,rel)
  rows.append({'path':rel,'installed':sha(src),'previous':sha(dst) if dst.exists() else None})
  if dst.exists():atomic_copy(dst,backup/'original'/rel)
 manifest=backup/'manifest.json';manifest.write_text(json.dumps({'site':str(site),'files':rows},indent=2)+'\n')
 with manifest.open('rb') as f:os.fsync(f.fileno())
 try:
  for r in rows:
   dst=safe(site,r['path']);atomic_copy(source/r['path'],dst);os.chmod(dst,0o644)
   current=dst.parent
   while current!=site:
    os.chmod(current,0o755);current=current.parent
  for r in rows:
   if sha(safe(site,r['path']))!=r['installed']:raise ValueError('Published bytes do not match the prepared tree')
 except Exception:
  restore(backup);raise
 print(f'Published and byte-checked {len(rows)} files. Backup: {backup}')
if __name__=='__main__':
 if len(sys.argv)==3 and sys.argv[1]=='--restore':restore(pathlib.Path(sys.argv[2]).resolve())
 elif len(sys.argv)==4:publish(*(pathlib.Path(x).resolve() for x in sys.argv[1:]))
 else:raise SystemExit('Usage: publish-files.py source site backup | --restore backup')
