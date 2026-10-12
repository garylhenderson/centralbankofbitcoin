import fcntl
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import subprocess

def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

activate = module('signing-activate')
refuse = module('signing-refuse')


class DeliveryTests(unittest.TestCase):
    def exercise(self, pid_change=False, validation_fail=False, reload_fail=False, death=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'vhost'
            target.write_bytes(b'closed')
            calls, pids = [], []
            def pidcheck(unit):
                pids.append(unit)
                if death and len(pids) == 2: raise RuntimeError('dead')
                return 2 if pid_change and len(pids) == 2 else 1
            def run(command):
                calls.append(command)
                if 'reload' in command and reload_fail: raise RuntimeError('reload failed')
                if 'start' in command:
                    # Proves error cleanup does not hold the activator lock.
                    with (root / 'delivery.lock').open('a') as lock:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    refuse.clear_runtime(root)
                return b''
            def validate():
                self.assertFalse((root / 'open').exists())
                if validation_fail: raise RuntimeError('invalid')
            def write(path, data, *unused): path.write_bytes(data)
            args = dict(root=root, target=target, run=run, pidcheck=pidcheck,
                        write=write, validate=validate)
            if pid_change or validation_fail or reload_fail or death:
                with self.assertRaises(RuntimeError): activate.open_window('unit', b'auth', b'active', **args)
                self.assertFalse((root / 'open').exists())
                self.assertFalse((root / 'auth.htpasswd').exists())
                self.assertIn('start', calls[-1])
            else:
                activate.open_window('unit', b'auth', b'active', **args)
                self.assertTrue((root / 'open').exists())
                self.assertEqual(len(pids), 2)
                self.assertEqual(target.read_bytes(), b'active')
                refuse.clear_runtime(root)
                self.assertFalse((root / 'open').exists())

    def test_success_and_subsequent_closure(self): self.exercise()
    def test_mainpid_change(self): self.exercise(pid_change=True)
    def test_validation_failure(self): self.exercise(validation_fail=True)
    def test_reload_failure(self): self.exercise(reload_fail=True)
    def test_death_during_activation(self): self.exercise(death=True)

    def test_warning_policy(self):
        for warning, allowed in [
            ('[warn] "ssl_stapling" ignored, no OCSP responder URL in other.pem', True),
            ('[warn] "ssl_stapling" ignored, issuer certificate not found for other.pem', True),
            ('[warn] "ssl_stapling" ignored, no OCSP responder URL in sign.centralbankofbitcoin.com', False),
            ('[warn] conflicting server name ignored', False),
            ('[warn] new unknown warning', False),
        ]:
            result = subprocess.CompletedProcess([], 0, b'', warning.encode())
            with patch.object(activate.subprocess, 'run', return_value=result):
                if allowed: activate.validate_nginx()
                else:
                    with self.assertRaises(RuntimeError): activate.validate_nginx()

    def test_listener_identity(self):
        props = b'MainPID=123\nActiveState=active\nSubState=running\n'
        one = 'LISTEN 0 511 127.0.0.1:8790 0.0.0.0:* users:(("node",pid=123,fd=3))\n'
        for data, passes in [(one, True), (one + one, False),
                             (one.replace('127.0.0.1:8790', '0.0.0.0:8790'), False),
                             (one.replace('pid=123', 'pid=456'), False), ('', False)]:
            def run(command): return props if 'show' in command else data.encode()
            if passes: self.assertEqual(activate.listener_pid('unit', run), 123)
            else:
                with self.assertRaises(RuntimeError): activate.listener_pid('unit', run)

    def test_lock_contention_closes_gate_before_wait(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'open').touch()
            (root / 'auth.htpasswd').write_bytes(b'temporary')
            with (root / 'delivery.lock').open('a') as held, (root / 'delivery.lock').open('a') as waiting:
                fcntl.flock(held, fcntl.LOCK_EX)
                refuse.clear_runtime(root)
                with self.assertRaises(TimeoutError): refuse.acquire(waiting, timeout=0.01)
                self.assertFalse((root / 'open').exists())
                self.assertFalse((root / 'auth.htpasswd').exists())


if __name__ == '__main__': unittest.main()
