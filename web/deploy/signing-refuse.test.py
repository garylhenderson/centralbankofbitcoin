"""Failure-path checks for the delivery gate, without production files/services."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('refuse', Path(__file__).with_name('signing-refuse.py'))
refuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refuse)


class ClosureTests(unittest.TestCase):
    def exercise(self, validation=0, warning=b'', reload=0, timeout=False):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            gate, target, template = (p / name for name in ('open', 'vhost', 'refusal'))
            gate.touch()
            target.write_bytes(b'active')
            template.write_bytes(b'closed')
            def run(command, **kwargs):
                self.assertFalse(gate.exists(), 'gate must close before external commands')
                if command[0].endswith('nginx'):
                    if timeout:
                        raise subprocess.TimeoutExpired(command, 8)
                    return subprocess.CompletedProcess(command, validation, b'', warning)
                return subprocess.CompletedProcess(command, reload, b'', b'')
            fails = validation or b'conflicting server name' in warning or reload or timeout
            if fails:
                with self.assertRaises(Exception):
                    refuse.close(gate, target, template, run)
            else:
                refuse.close(gate, target, template, run)
            self.assertFalse(gate.exists())
            self.assertEqual(target.read_bytes(), b'active' if validation or b'conflicting server name' in warning or timeout else b'closed')
    def test_success(self): self.exercise()
    def test_validation_failure(self): self.exercise(validation=1)
    def test_duplicate_host_warning(self): self.exercise(warning=b'conflicting server name')
    def test_existing_ocsp_warning(self): self.exercise(warning=b'ssl_stapling ignored, no OCSP responder')
    def test_reload_failure(self): self.exercise(reload=1)
    def test_timeout(self): self.exercise(timeout=True)


if __name__ == '__main__':
    unittest.main()
