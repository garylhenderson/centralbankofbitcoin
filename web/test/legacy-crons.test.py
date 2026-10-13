import importlib.util, pathlib, sys
sys.dont_write_bytecode=True
root=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('cleanup',root/'web/deploy/cleanup-legacy-crons.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
other='# do not change\n13 * * * * unrelated job --secret fixture\n'
dead='7 9 * * * cd /opt/cbob-vaults && node bank/distribute.mjs >> /tmp/old.log 2>&1\n'
notice='8 * * * * curl -X POST -H "Authorization: Bearer $(read /opt/gary-club/.env.local)" http://localhost:3003/api/cron/cbob-reconcile >> /tmp/notice.log 2>&1\n'
result=c.transform(other+dead+notice)
assert result.startswith(other) and 'bank/distribute.mjs' not in result and 'Authorization:' not in result and result.count('8 * * * *')==1
print('ok exact unrelated lines and Notice schedule preserved; dead payout and argv auth removed')
for invalid in [other+notice,other+dead,other+dead+notice+notice,other+dead+dead+notice,other+dead+notice.replace('8 *','9 *',1),other+dead+notice.replace('localhost:3003','other.invalid')]:
 try:c.transform(invalid)
 except ValueError:pass
 else:raise AssertionError('ambiguous cron layout accepted')
print('ok missing, duplicate, changed schedule and foreign origin refuse')
