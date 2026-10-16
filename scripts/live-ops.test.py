import importlib.util, pathlib, unittest
spec = importlib.util.spec_from_file_location('installer', pathlib.Path(__file__).with_name('install-live-ops.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class CronSafety(unittest.TestCase):
    def test_preserves_foreign_bytes_and_idempotence(self):
        original = '# private unrelated schedule\nMAILTO=private@example.invalid\n3 * * * * /some/foreign-task --private=x\n'
        after, removed = m.cron_plan(original)
        self.assertTrue(after.startswith(original)); self.assertEqual(removed, [])
        self.assertEqual(m.cron_plan(after)[0], after)
        self.assertEqual(after.count('#cbob-vault-cron '),4)
    def test_untagged_new_money_job_refuses(self):
        for role in ['crank','revenue','fee-topup']:
            with self.assertRaisesRegex(RuntimeError,'Unrecognized'):
                m.cron_plan(f'* * * * * cd /opt/cbob-vaults && node bank/{role}.mjs --live\n')
    def test_core_deadman_route_changes_only_named_line(self):
        body='29 * * * * /opt/scripts/notify-gary-sms.sh "private" x #cbob-vault-cron core-watch-deadman\n'
        other='2 * * * * /opt/scripts/notify-gary-sms.sh "unrelated" other\n'
        after,_=m.cron_plan(body+other)
        self.assertIn(body.replace('/opt/scripts/notify-gary-sms.sh','/opt/cbob-vaults/bank/ops-notify.mjs'),after)
        self.assertIn(other,after)
if __name__=='__main__':unittest.main()
