"""Execute the real readiness helper without importing the production harness."""
import ast
from pathlib import Path
import unittest
import re

source = ast.parse(Path(__file__).with_name('verify-signing-delivery.py').read_text())
function = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == 'wait_for_listener')
function.args.defaults = []
scope = {}
exec(compile(ast.Module(body=[function], type_ignores=[]), '<readiness helper>', 'exec'), scope)
wait = scope['wait_for_listener']


class ReadinessTests(unittest.TestCase):
    def test_genesis_check_matches_canonical_configuration(self):
        config = (Path(__file__).parents[1] / 'src/config.js').read_text()
        expected = re.search("const MAINNET_GENESIS = '([^']+)'", config)[1]
        literals = [n.value for n in ast.walk(source) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        self.assertIn(expected, literals)

    def test_real_runtime_errors_retry_until_ready(self):
        attempts, pauses = [], []
        def probe():
            attempts.append(True)
            if len(attempts) < 3: raise RuntimeError('listener not bound yet')
            return 123
        self.assertEqual(wait(probe, pauses.append), 123)
        self.assertEqual(len(pauses), 2)

    def test_exhaustion_raises_instead_of_falling_through(self):
        pauses = []
        def probe(): raise RuntimeError('not ready')
        with self.assertRaisesRegex(RuntimeError, 'Service failed to listen'):
            wait(probe, pauses.append)
        self.assertEqual(len(pauses), 50)

    def test_unexpected_errors_are_not_retried(self):
        def probe(): raise ValueError('bad configuration')
        with self.assertRaises(ValueError): wait(probe, lambda _: None)


if __name__ == '__main__': unittest.main()
