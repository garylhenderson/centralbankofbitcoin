#!/usr/bin/env python3
"""Activate a reviewed read-only producer, restoring its predecessor on failure."""
import json, os, pathlib, pwd, re, shutil, signal, subprocess, sys, tempfile, uuid

class RollbackFailed(RuntimeError): pass
class ActivationFailed(RuntimeError): pass
class RefreshStillRunning(RuntimeError): pass

def run_first_refresh(command, backup, timeout=480, run_as=None):
 # Discard raw output: it may contain credential-bearing RPC URLs. Record status only.
 identity = {}
 if run_as:
  member = pwd.getpwnam(run_as)
  identity = {'user':member.pw_uid,'group':member.pw_gid,'extra_groups':[],
   'env':{'HOME':member.pw_dir,'USER':run_as,'LOGNAME':run_as,'PATH':'/usr/bin:/bin'}}
 proc = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, **identity)
 timed_out = False
 try:
  proc.wait(timeout=timeout)
 except subprocess.TimeoutExpired:
  timed_out = True
  # Python execs Node directly; there is no runuser wrapper creating another session.
  try: os.killpg(proc.pid, signal.SIGKILL)
  except ProcessLookupError: pass
  proc.wait()
 (backup/'first-run.json').write_text(json.dumps({'returncode':proc.returncode,'timed_out':timed_out})+'\n')
 if timed_out: raise RuntimeError('First refresh timed out.')
 if proc.returncode: raise RuntimeError('First refresh failed.')

def run_isolated_refresh(command, backup, properties, timeout=490, runtime=480):
 unit='cbob-public-data-refresh-'+uuid.uuid4().hex+'.service'
 try:
  run_first_refresh(['/usr/bin/systemd-run','--unit='+unit,'--quiet','--wait','--pipe','--collect','--property=RuntimeMaxSec='+str(runtime),'--property=TimeoutStopSec=5',*['--property='+p for p in properties],*command],backup,timeout=timeout)
 finally:
  # Killing systemd-run does not kill its service. Stop the named unit and
  # confirm its state BEFORE activate() may restore the predecessor.
  try:
   subprocess.run(['systemctl','stop',unit],check=False,timeout=20,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   state=subprocess.check_output(['systemctl','show',unit,'--property=ActiveState','--value'],text=True,timeout=10,stderr=subprocess.DEVNULL).strip()
   if state not in ('inactive','failed'):raise RuntimeError('Transient still active')
  except Exception:
   # No automatic predecessor restoration or future scheduled writer while
   # the old refresh's termination is uncertain. Leave explicit recovery work.
   try:subprocess.run(['systemctl','stop','cbob-public-data.timer','cbob-public-data.service'],check=False,timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   except Exception:pass
   raise RefreshStillRunning('Refresh shutdown unverified; producer shutdown requested; retain new source for manual recovery.') from None

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
 except RefreshStillRunning as original:
  raise RollbackFailed('Refresh shutdown unverified; predecessor was NOT restored.') from original
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
  isolation=pathlib.Path('/etc/systemd/system/cbob-public-data.service.d/90-isolation.conf')
  if isolation.exists():
   expected=(source/'web/deploy/public-data-isolation.conf').read_bytes()
   if isolation.is_symlink() or isolation.stat().st_uid!=0 or isolation.stat().st_mode&0o022 or isolation.read_bytes()!=expected:
    raise RuntimeError('Installed public-data isolation differs from reviewed source.')
   # Exercise the SAME identity and sandbox during the first refresh. The
   # caller already owns the producer flock; this transient does not reacquire it.
   properties=[line for line in expected.decode().splitlines() if line and not line.startswith(('[','#'))]
   run_isolated_refresh(['/usr/bin/python3',str(source/'web/deploy/run-public-data.py')],backup,properties)
  else:
   run_first_refresh(['/usr/bin/python3',str(source/'web/deploy/run-public-data.py')], backup, run_as='ubuntu')
 try:
  backup=activate(pathlib.Path('/etc/systemd/system/cbob-public-data.service'),pathlib.Path('/etc/systemd/system/cbob-public-data.service.d/50-reviewed-source.conf'),pathlib.Path('/var/backups/cbob-public-data'),(source/'web/deploy/cbob-public-data.service').read_bytes(),pathlib.Path(sys.argv[2]).read_bytes(),reload_unit,first_run)
 except RollbackFailed:
  raise SystemExit('RESTORE FAILED: public-data activation and override restoration failed. Manual recovery required; inspect the private activation backup and unit state.')
 except ActivationFailed:
  raise SystemExit('Public-data activation failed. Previous override restored, or the base unit remains disabled. No fallback to the editing checkout.')
 except Exception:
  raise SystemExit('Public-data activation could not complete. Inspect the unit state and private activation backup before retrying.')
 print('Public-data first refresh passed. Unit restore point: '+str(backup))
