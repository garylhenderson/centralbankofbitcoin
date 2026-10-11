#!/usr/bin/env python3
"""Activate a reviewed read-only producer, restoring its predecessor on failure."""
import json, os, pathlib, re, shutil, subprocess, sys, tempfile

def atomic_write(target, data):
 if target.is_symlink(): raise ValueError('Refusing a symlink unit file')
 target.parent.mkdir(parents=True, exist_ok=True)
 fd, name = tempfile.mkstemp(dir=target.parent)
 try:
  with os.fdopen(fd, 'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
  os.chmod(name, 0o644); os.replace(name, target)
 finally:
  if os.path.exists(name): os.unlink(name)

def activate(base, target, backup_root, base_bytes, override_bytes, reload_unit, first_run):
 backup_root.mkdir(parents=True, exist_ok=True)
 backup = pathlib.Path(tempfile.mkdtemp(prefix='source-', dir=backup_root))
 previous = target.exists()
 if base.exists(): shutil.copy2(base, backup / 'base.service')
 if previous: shutil.copy2(target, backup / 'override.conf')
 (backup / 'manifest.json').write_text(json.dumps({'had_override':previous,'base':str(base),'override':str(target)})+'\n')
 # Never restore the editing-checkout fallback, even if activation fails.
 atomic_write(base, base_bytes)
 try:
  atomic_write(target, override_bytes)
  reload_unit()
  first_run(backup)
 except Exception:
  if previous: atomic_write(target, (backup / 'override.conf').read_bytes())
  elif target.exists(): target.unlink()
  reload_unit()
  raise
 return backup

if __name__ == '__main__':
 if os.geteuid() != 0 or len(sys.argv) != 3: raise SystemExit('Run through pin-public-data.sh.')
 source = pathlib.Path(sys.argv[1]).resolve()
 if source.parent != pathlib.Path('/opt/cbob-public-data') or not re.fullmatch(r'[a-f0-9]{40}', source.name): raise SystemExit('Invalid reviewed source path.')
 def reload_unit(): subprocess.run(['systemctl','daemon-reload'],check=True)
 def first_run(backup):
  result = subprocess.run(['runuser','-u','ubuntu','--','/usr/bin/python3',str(source/'web/deploy/run-public-data.py')],capture_output=True,text=True)
  (backup/'first-run.log').write_text(result.stdout+result.stderr)
  if result.returncode: raise RuntimeError('First refresh failed; see the private activation backup.')
 try:
  backup=activate(pathlib.Path('/etc/systemd/system/cbob-public-data.service'),pathlib.Path('/etc/systemd/system/cbob-public-data.service.d/50-reviewed-source.conf'),pathlib.Path('/var/backups/cbob-public-data'),(source/'web/deploy/cbob-public-data.service').read_bytes(),pathlib.Path(sys.argv[2]).read_bytes(),reload_unit,first_run)
 except Exception:
  raise SystemExit('Public-data activation failed. Previous override restored, or the base unit remains disabled. No fallback to the editing checkout.')
 print('Public-data first refresh passed. Unit restore point: '+str(backup))
