#!/usr/bin/env python3
"""Narrow, owner-authorized operational release; never rewrites foreign jobs."""
import argparse, datetime, hashlib, json, os, pathlib, re, subprocess

ROOT = pathlib.Path('/opt/cbob-vaults')
STATE = pathlib.Path('/var/lib/cbob-ops')
OLD_REVENUE = '43e838f38fa190be1b0238df3b25f15169c8fe1478c08f6f91c1a5253534de2f'
JOBS = [
 ('37 * * * *', 'crank', 'bank/crank.mjs --live'),
 ('* * * * *', 'crank-reveal', 'bank/crank.mjs --live --reveal-only'),
 ('41 * * * *', 'revenue', 'bank/revenue.mjs --live'),
 ('* * * * *', 'fee-topup', 'bank/fee-topup.mjs --live'),
]
def cron_plan(before):
    keep, removed = [], []
    for line in before.splitlines(keepends=True):
        text = line.strip()
        money = not text.startswith('#') and re.search(r'\bbank/(crank|revenue|fee-topup)\.mjs\b', text)
        if money:
            legacy = hashlib.sha256(line.rstrip('\n').encode()).hexdigest() == OLD_REVENUE
            ours = re.search(r'#cbob-vault-cron (crank|crank-reveal|revenue|fee-topup)\s*$', text)
            if not (legacy or ours): raise RuntimeError('Unrecognized money schedule; refusing to overwrite it')
            removed.append(line)
        elif '#cbob-vault-cron core-watch-deadman' in line:
            keep.append(line.replace('/opt/scripts/notify-gary-sms.sh', str(ROOT / 'bank/ops-notify.mjs')))
        else: keep.append(line)
    after = ''.join(keep)
    if after and not after.endswith('\n'): after += '\n'
    for schedule, name, command in JOBS:
        after += f'{schedule} cd {ROOT} && /usr/bin/flock -n {STATE}/{name}.flock {ROOT}/bank/ops-node {ROOT}/bank/ops-run.mjs {command} >> /var/log/cbob/{name}.log 2>&1 #cbob-vault-cron {name}\n'
    return after, removed

SERVICE = '''[Unit]
Description=CBOB operational schedule and fee reserve watch
After=network-online.target
[Service]
Type=oneshot
User=ubuntu
Group=ubuntu
WorkingDirectory=/opt/cbob-vaults
UMask=0077
ExecStart=/opt/cbob-vaults/bank/ops-node /opt/cbob-vaults/bank/ops-watch.mjs
TimeoutStartSec=90
NoNewPrivileges=true
'''
TIMER = '''[Unit]
Description=Watch CBOB operational job health every two minutes
[Timer]
OnBootSec=4min
OnUnitActiveSec=2min
Unit=cbob-ops-watch.service
[Install]
WantedBy=timers.target
'''
def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--execute', metavar='COMMIT')
    args = p.parse_args()
    assert os.getuid() != 0, 'Run as ubuntu'
    def run(*argv): return subprocess.check_output(argv, cwd=ROOT, text=True).strip()
    before = subprocess.check_output(['crontab', '-l'], text=True)
    after, removed = cron_plan(before)
    digest = lambda text: hashlib.sha256(text.encode()).hexdigest()
    report = {'at':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'before_sha256':digest(before), 'after_sha256':digest(after),
              'removed_money_jobs':len(removed), 'installed_money_jobs':[{'schedule':s,'role':n,'live':True} for s,n,_ in JOBS], 'executed':False}
    if not args.execute: print(json.dumps(report)); return
    assert run('git','rev-parse','HEAD') == args.execute and not run('git','status','--porcelain','--untracked-files=all'), 'Use exact clean source'
    assert run('git','ls-remote','origin','refs/heads/v6').split()[0] == args.execute, 'Commit and push first'
    assert not (ROOT / 'REHEARSAL-RECORD.txt').exists(), 'No rehearsal activation'
    health = json.loads((STATE / 'topup-health.json').read_text())
    assert health['ok'] and health['balances']['crank'] >= 50000000 and health['balances']['operator'] >= 25000000, 'Funded fee wallets required'
    for _, name, _ in JOBS:
        state = json.loads((STATE / ('job-' + {'fee-topup':'topup','crank-reveal':'reveal'}.get(name,name) + '.json')).read_text())
        assert state['process_ok'] and state['last_success'], 'Prime every live job before enabling its watch'
    assert (ROOT / 'bank/runtime/node_modules/tsx/package.json').is_file(), 'Pinned runtime required'
    assert len(re.findall(r'#cbob-vault-cron (?:crank|crank-reveal|revenue|fee-topup)\s*$', after, re.M)) == 4, 'Exactly four money schedules'
    os.umask(0o077)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')
    backup = STATE / ('activation-' + stamp)
    backup.mkdir(mode=0o700)
    (backup / 'crontab.before').write_text(before)
    (backup / 'crontab.after').write_text(after)
    # Neither systemd unit may replace a service owned by another deployment.
    for name, body in [('cbob-ops-watch.service',SERVICE),('cbob-ops-watch.timer',TIMER)]:
        path = pathlib.Path('/etc/systemd/system') / name
        if path.exists(): assert path.read_text() == body, 'Existing watch unit differs'
        staged = backup / name
        staged.write_text(body)
        subprocess.run(['sudo','install','-o','root','-g','root','-m','644',str(staged),str(path)],check=True)
    subprocess.run(['sudo','install','-d','-o','ubuntu','-g','ubuntu','-m','750','/var/log/cbob'],check=True)
    # Do not lose a concurrent cron edit between the read and write.
    assert subprocess.check_output(['crontab','-l'],text=True) == before, 'Concurrent crontab update; retry after inspection'
    subprocess.run(['crontab',str(backup/'crontab.after')],check=True)
    assert subprocess.check_output(['crontab','-l'],text=True) == after, 'Installed crontab differs'
    subprocess.run(['sudo','systemctl','daemon-reload'],check=True)
    subprocess.run(['sudo','systemctl','enable','--now','cbob-ops-watch.timer'],check=True)
    assert run('systemctl','is-active','cbob-ops-watch.timer') == 'active'
    report.update(executed=True, source=args.execute, backup=str(backup), watch_timer_active=True)
    (backup/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
if __name__ == '__main__': main()
