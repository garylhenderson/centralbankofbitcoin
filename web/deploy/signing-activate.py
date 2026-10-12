#!/usr/bin/python3 -I
"""Open the reviewed signing route only for its verified running service.

Root-owned installation only. CLI accepts no arguments and uses Gary's existing
credential. The read-only verification harness may call activate with a temporary
entry; it lives only in /run, never in the permanent password file.
"""
from contextlib import contextmanager
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

RUNTIME = Path('/run/cbob-signing')
TARGET = Path('/etc/nginx/sites-available/cbob-signing')
ACTIVE = Path('/etc/nginx/cbob-signing-active.conf')
AUTH = Path('/etc/nginx/cbob-mainnet-ceremony.htpasswd')
STATE = Path('/etc/cbob/signing-delivery-state.json')


def command(args):
    result = subprocess.run(args, capture_output=True, timeout=8)
    if result.returncode:
        raise RuntimeError('Delivery command failed')
    return result.stdout


def listener_pid(unit, run=command):
    properties = dict(line.split('=', 1) for line in run([
        '/usr/bin/systemctl', 'show', unit, '-p', 'MainPID', '-p', 'ActiveState',
        '-p', 'SubState']).decode().splitlines())
    if properties.get('ActiveState') != 'active' or properties.get('SubState') != 'running':
        raise RuntimeError('Signing service is not running')
    pid = properties.get('MainPID', '')
    if not pid.isdigit() or int(pid) <= 0:
        raise RuntimeError('Signing service has no MainPID')
    listeners = run(['/usr/bin/ss', '-H', '-ltnp', 'sport = :8790']).decode().splitlines()
    if (len(listeners) != 1 or len(listeners[0].split()) < 5 or
            listeners[0].split()[3] != '127.0.0.1:8790' or
            set(re.findall(r'pid=(\d+)', listeners[0])) != {pid}):
        raise RuntimeError('Signing listener identity differs')
    return int(pid)


def atomic(path, data, mode=0o644, gid=0):
    fd, name = tempfile.mkstemp(prefix='.cbob-delivery-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(name, mode)
        os.chown(name, 0, gid)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def owner_auth(path=AUTH):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as file:
        metadata = os.fstat(file.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or
                metadata.st_gid != grp.getgrnam('www-data').gr_gid or
                stat.S_IMODE(metadata.st_mode) != 0o640):
            raise RuntimeError('Unexpected owner-auth metadata')
        data = file.read()
    if not re.fullmatch(rb'gary:[^\r\n]+\n', data):
        raise RuntimeError('Expected only the existing Gary credential')
    return data


@contextmanager
def delivery_lock(root):
    fd = os.open(root / 'delivery.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    with os.fdopen(fd, 'a') as lock:
        metadata = os.fstat(lock.fileno())
        if metadata.st_uid != os.geteuid() or metadata.st_mode & 0o077:
            raise RuntimeError('Unsafe activation lock')
        deadline = time.monotonic() + 5
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('Activation lock timed out')
                time.sleep(0.05)
        yield


def validate_nginx():
    checked = subprocess.run(['/usr/sbin/nginx', '-t'], capture_output=True, timeout=8)
    # Only the existing unrelated OCSP warning class is accepted.
    warnings = [line for line in checked.stderr.decode().splitlines()
                if '[warn]' in line and not (
                    any(message in line for message in (
                                '"ssl_stapling" ignored, no OCSP responder URL',
                                '"ssl_stapling" ignored, issuer certificate not found')) and
                    'sign.centralbankofbitcoin.com' not in line)]
    if checked.returncode or warnings or b'conflicting server name' in checked.stderr:
        raise RuntimeError('Activation nginx validation failed')


def open_window(unit, owner, active, root=RUNTIME, target=TARGET,
                run=command, pidcheck=listener_pid, write=atomic, validate=None):
    gate = root / 'open'
    validate = validate or validate_nginx
    try:
        with delivery_lock(root):
            if gate.exists():
                raise RuntimeError('A signing window is already open')
            pid = pidcheck(unit)
            write(root / 'auth.htpasswd', owner, 0o640, grp.getgrnam('www-data').gr_gid)
            write(target, active)
            validate()
            run(['/usr/bin/systemctl', 'reload', 'nginx'])
            if pidcheck(unit) != pid:
                raise RuntimeError('Signing service changed during activation')
            fd = os.open(gate, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            os.fchmod(fd, 0o644)
            os.close(fd)
    except Exception:
        gate.unlink(missing_ok=True)
        (root / 'auth.htpasswd').unlink(missing_ok=True)
        # The context above releases the shared lock before the refusal job waits.
        run(['/usr/bin/systemctl', 'start', 'cbob-signing-refuse.service'])
        raise


def activate(verification_entry=None):
    if os.geteuid() != 0:
        raise RuntimeError('Root required')
    if RUNTIME.is_symlink() or RUNTIME.stat().st_uid != 0 or RUNTIME.stat().st_mode & 0o022:
        raise RuntimeError('Unsafe runtime directory')
    state = json.loads(STATE.read_text())
    commit = state['source_commit']
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Invalid artifact identity')
    for path in (ACTIVE, Path('/etc/nginx/cbob-signing-location.conf')):
        expected = next((row['sha256'] for row in state['files'] if row['destination'] == str(path)), None)
        if not expected or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Installed delivery configuration differs')
    owner = owner_auth()
    if verification_entry is None:
        timer = dict(line.split('=', 1) for line in command([
            '/usr/bin/systemctl', 'show', 'cbob-signing-verification-expiry.timer',
            '-p', 'LoadState', '-p', 'ActiveState']).decode().splitlines())
        if timer.get('LoadState') != 'not-found' or timer.get('ActiveState') != 'inactive':
            raise RuntimeError('Verification timer must be retired before an owner window')
    if verification_entry is not None:
        if not re.fullmatch(rb'cbobverify_[a-f0-9]{24}:\$6\$[./a-zA-Z0-9$]+\n', verification_entry):
            raise RuntimeError('Invalid temporary verification entry')
        # Must be scheduled before any temporary credential exists.
        timer = 'cbob-signing-verification-expiry.timer'
        command(['/usr/bin/systemd-run', '--unit=cbob-signing-verification-expiry',
                 '--on-active=15m', '/usr/bin/systemctl', 'start', 'cbob-signing-refuse.service'])
        fields = dict(line.split('=', 1) for line in command([
            '/usr/bin/systemctl', 'show', timer, '-p', 'ActiveState',
            '-p', 'NextElapseUSecMonotonic']).decode().splitlines())
        if fields.get('ActiveState') != 'active' or fields.get('NextElapseUSecMonotonic') in (None, '', '0'):
            raise RuntimeError('Verification expiry timer is not armed')
        owner += verification_entry
    open_window('cbob-ceremony@' + commit + '.service', owner, ACTIVE.read_bytes())


if __name__ == '__main__':
    try:
        if len(__import__('sys').argv) != 1:
            raise RuntimeError('Arguments are not accepted')
        activate()
    except Exception as error:
        print('Signing activation refused: ' + type(error).__name__, file=__import__('sys').stderr)
        raise SystemExit(1)
