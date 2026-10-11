#!/usr/bin/env python3
"""Activate a reviewed read-only producer, restoring its predecessor on failure."""
import json, os, pathlib, re, shutil, signal, subprocess, sys, tempfile

class RollbackFailed(RuntimeError): pass
class ActivationFailed(RuntimeError): pass

def run_first_refresh(command, backup, timeout=480):
 # Discard raw output: it may contain credential-bearing RPC URLs. Record status only.
 proc = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
 timed_out = False
 try:
  proc.wait(timeout=timeout)
 except subprocess.TimeoutExpired:
  timed_out = True
  # runuser may have forked the Python/Node process. Kill the whole refresh group.
  try: os.killpg(proc.pid, signal.SIGKILL)
  except ProcessLookupError: pass
  proc.wait()
 (backup/'first-run.json').write_text(json.dumps({'returncode':proc.returncode,'timed_out':timed_out})+'\n')
 if timed_out: raise RuntimeError('First refresh timed out.')
 if proc.returncode: raise RuntimeError('First refresh failed.')

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
 except Exception as original:
  try:
   if previous: atomic_write(target, (backup / 'override.conf').read_bytes())
   elif target.exists(): target.unlink()
   reload_unit()
  except Exception:
   raise RollbackFailed('Activation and override restoration failed; manual recovery required.') from original
  raise ActivationFailed('Activation failed; prior override restored or base left disabled.') from original
 return backup

if __name__ == '__main__':
 if os.geteuid() != 0 or len(sys.argv) != 3: raise SystemExit('Run through pin-public-data.sh.')
 source = pathlib.Path(sys.argv[1]).resolve()
 if source.parent != pathlib.Path('/opt/cbob-public-data') or not re.fullmatch(r'[a-f0-9]{40}', source.name): raise SystemExit('Invalid reviewed source path.')
 def reload_unit(): subprocess.run(['systemctl','daemon-reload'],check=True)
 def first_run(backup):
  run_first_refresh(['runuser','-u','ubuntu','--','/usr/bin/python3',str(source/'web/deploy/run-public-data.py')], backup)
 try:
  backup=activate(pathlib.Path('/etc/systemd/system/cbob-public-data.service'),pathlib.Path('/etc/systemd/system/cbob-public-data.service.d/50-reviewed-source.conf'),pathlib.Path('/var/backups/cbob-public-data'),(source/'web/deploy/cbob-public-data.service').read_bytes(),pathlib.Path(sys.argv[2]).read_bytes(),reload_unit,first_run)
 except RollbackFailed:
  raise SystemExit('RESTORE FAILED: public-data activation and override restoration failed. Manual recovery required; inspect the private activation backup and unit state.')
 except ActivationFailed:
  raise SystemExit('Public-data activation failed. Previous override restored, or the base unit remains disabled. No fallback to the editing checkout.')
 except Exception:
  raise SystemExit('Public-data activation could not complete. Inspect the unit state and private activation backup before retrying.')
 print('Public-data first refresh passed. Unit restore point: '+str(backup))
