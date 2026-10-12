#!/usr/bin/python3 -I
"""Close the runtime gate first, then replace the one signing vhost.

Install this reviewed file root-owned in /usr/local/libexec. Invoke through the
separate root oneshot unit, outside the ceremony DynamicUser filesystem namespace.
No CLI paths or environment configuration are accepted. No secret file is read.
"""
import fcntl
import os
from pathlib import Path
import subprocess
import tempfile
import time


def atomic(path, data):
    fd, name = tempfile.mkstemp(prefix='.cbob-signing-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(name, 0o644)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def close(gate, target, refusal, run=subprocess.run):
    # This takes effect in existing nginx workers, even if validation/reload fails.
    gate.unlink(missing_ok=True)
    previous = target.read_bytes()
    atomic(target, refusal.read_bytes())
    try:
        checked = run(['/usr/sbin/nginx', '-t'], capture_output=True, timeout=8)
        if checked.returncode or b'conflicting server name' in checked.stderr:
            raise RuntimeError('Signing refusal nginx validation failed')
    except Exception:
        atomic(target, previous)
        raise
    result = run(['/usr/bin/systemctl', 'reload', 'nginx'],
                 capture_output=True, timeout=8)
    if result.returncode:
        raise RuntimeError('Signing refusal reload failed; runtime gate is closed')


def acquire(lock, timeout=5):
    deadline = time.monotonic() + timeout
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise TimeoutError('Signing delivery lock remained held')
            time.sleep(0.05)


def clear_runtime(root):
    (root / 'open').unlink(missing_ok=True)
    (root / 'auth.htpasswd').unlink(missing_ok=True)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Root required')
    if len(__import__('sys').argv) != 1:
        raise RuntimeError('Arguments are not accepted')
    root = Path('/run/cbob-signing')
    if root.is_symlink() or root.stat().st_uid != 0 or root.stat().st_mode & 0o022:
        raise RuntimeError('Unsafe runtime directory')
    clear_runtime(root)  # Do not wait for a stalled activator before closing.
    fd = os.open(root / 'delivery.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    with os.fdopen(fd, 'a') as lock:
        metadata = os.fstat(lock.fileno())
        if metadata.st_uid != 0 or metadata.st_mode & 0o077:
            raise RuntimeError('Unsafe closure lock')
        acquire(lock)
        clear_runtime(root)  # Close again if activation raced the first unlink.
        close(root / 'open', Path('/etc/nginx/sites-available/cbob-signing'),
              Path('/etc/nginx/cbob-signing-refusal.conf'))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # nginx diagnostics can contain paths. Keep logs free of private routes.
        print('Signing delivery closure failed: ' + type(error).__name__,
              file=__import__('sys').stderr)
        raise SystemExit(1)
