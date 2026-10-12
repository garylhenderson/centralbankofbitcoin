"""Brief read-only delivery verification. Never builds/sends transactions."""
from pathlib import Path
import os, json, subprocess, secrets, base64, ssl, urllib.request, urllib.error, hashlib, time, re, fcntl, crypt, importlib.util, socket, http.client
if not os.geteuid() == 0:
    raise RuntimeError('Delivery safety check failed')
state = json.loads(Path('/etc/cbob/signing-delivery-state.json').read_text())
commit = state['source_commit']
unit = 'cbob-ceremony@' + commit + '.service'
origin = 'https://sign.centralbankofbitcoin.com'
base = origin + '/' + state['outer_path'] + '/'
artifact = Path('/opt/cbob-ceremony') / commit
manifest = json.loads((artifact / 'ARTIFACT.json').read_text())
if not hashlib.sha256((artifact / 'ARTIFACT.json').read_bytes()).hexdigest() == state['artifact_sha256']:
    raise RuntimeError('Delivery safety check failed')
for (name, digest) in manifest['files'].items():
    if not hashlib.sha256((artifact / name).read_bytes()).hexdigest() == digest:
        raise RuntimeError('Delivery safety check failed')
pageprefix = 'web/dist-mainnet-local/'
app = next((k.removeprefix(pageprefix) for k in manifest['files'] if k.startswith(pageprefix + 'ceremony-') and k.endswith('/app.js')))
slug = app.split('/')[0]
user = 'cbobverify_' + secrets.token_hex(12)
password = secrets.token_urlsafe(32)
authorization = 'Basic ' + base64.b64encode((user + ':' + password).encode()).decode()
auth = Path('/etc/nginx/cbob-mainnet-ceremony.htpasswd')
original = auth.read_bytes()
before = auth.stat()
if not (original.endswith(b'\n') and original.count(b'gary:') == 1):
    raise RuntimeError('Delivery safety check failed')
gate = Path('/run/cbob-signing/open')
target = Path('/etc/nginx/sites-available/cbob-signing')
report = {'source_commit': commit, 'artifact_sha256': state['artifact_sha256'], 'delivery_commit': state['delivery_commit'], 'checks': []}

def run(args):
    r = subprocess.run(args, capture_output=True, timeout=40)
    if not r.returncode == 0:
        raise RuntimeError('Command failed: ' + args[0])
    return r.stdout

def request(url, authed=False, body=None, headers=None):
    h = dict(headers or {})
    if authed:
        h['Authorization'] = authorization
    if body is not None:
        h['Content-Type'] = 'application/json'
        body = json.dumps(body).encode()
    q = urllib.request.Request(url, data=body, headers=h)
    try:
        with urllib.request.urlopen(q, timeout=20) as r:
            return (r.status, r.read(), r.headers)
    except urllib.error.HTTPError as e:
        return (e.code, e.read(), e.headers)

def check(name, ok):
    if not ok:
        raise RuntimeError('Check failed: ' + name)
    report['checks'].append(name)

def mainpid():
    return activation.listener_pid(unit)


def wait_for_listener(probe=mainpid, pause=time.sleep):
    for _ in range(50):
        try:
            return probe()
        except RuntimeError:
            pause(0.2)
    raise RuntimeError('Service failed to listen')

spec = importlib.util.spec_from_file_location('activation', '/usr/local/libexec/cbob-signing-activate.py')
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)
entry = (user + ':' + crypt.crypt(password, crypt.mksalt(crypt.METHOD_SHA512)) + '\n').encode()

def activate(verify=False):
    activation.activate(entry if verify else None)
    for _ in range(40):
        if request(base + slug + '/')[0] == 401:
            return
        time.sleep(0.2)
    raise AssertionError('Authenticated route not observed after reload')

def stopped(name):
    for _ in range(60):
        if not gate.exists() and request(base)[0] in [404, 503]:
            break
        time.sleep(0.2)
    else:
        raise AssertionError('Automatic closure failed')
    if not not run(['ss', '-H', '-ltnp', 'sport = :8790']).strip():
        raise RuntimeError('Delivery safety check failed')
    if not not Path('/run/cbob-signing/auth.htpasswd').exists():
        raise RuntimeError('Delivery safety check failed')
    for _ in range(40):
        result = run(['systemctl', 'show', 'cbob-signing-refuse.service', '-p', 'Result']).decode()
        if target.read_bytes() == Path('/etc/nginx/cbob-signing-refusal.conf').read_bytes() and 'Result=success' in result:
            break
        time.sleep(0.2)
    else:
        raise RuntimeError('Closure did not reach reviewed refusal state')
    check(name, True)

def retire_verification_timer():
    for args in [['systemctl', 'stop', 'cbob-signing-verification-expiry.timer', 'cbob-signing-verification-expiry.service'], ['systemctl', 'reset-failed', 'cbob-signing-verification-expiry.service', 'cbob-signing-verification-expiry.timer']]:
        subprocess.run(args, capture_output=True, timeout=30)
backup = Path('/var/backups/cbob-signing')
if not (backup.is_dir() and backup.stat().st_uid == 0 and (backup.stat().st_mode & 511 == 448)):
    raise RuntimeError('Delivery safety check failed')
try:
    for _ in range(6):
        run(['systemctl', 'start', 'cbob-signing-refuse.service'])
    check('six_rapid_closures_succeed', not gate.exists())
    report['closure_unit_properties'] = run(['systemctl', 'show', 'cbob-signing-refuse.service', '-p', 'StartLimitIntervalUSec', '-p', 'DefaultDependencies', '-p', 'RuntimeDirectoryPreserve']).decode().splitlines()
    run(['systemctl', 'start', unit])
    wait_for_listener()
    check('sole_listener_matches_dynamic_service', True)
    props = run(['systemctl', 'show', unit, '-p', 'DynamicUser', '-p', 'RuntimeMaxUSec', '-p', 'ProtectSystem', '-p', 'NoNewPrivileges', '-p', 'RestrictAddressFamilies', '-p', 'UnsetEnvironment']).decode()
    report['service_properties'] = dict((l.split('=', 1) for l in props.splitlines()))
    if not (report['service_properties']['DynamicUser'] == 'yes' and report['service_properties']['ProtectSystem'] == 'strict' and (report['service_properties']['NoNewPrivileges'] == 'yes')):
        raise RuntimeError('Delivery safety check failed')
    for header in [{}, {'X-CBOB-Ceremony': '0' * 64}]:
        check('direct_listener_refuses_missing_or_wrong_secret', request('http://127.0.0.1:8790/BUILD.txt', headers=header)[0] == 403)
    activate(True)
    check('nginx_authentication_required', request(base + slug + '/')[0] == 401)
    for rel in ['BUILD.txt', slug + '/index.html', app, 'assets/style.css']:
        (status, data, h) = request(base + rel, True)
        check('served_bytes_' + rel.split('/')[-1], status == 200 and hashlib.sha256(data).hexdigest() == manifest['files'][pageprefix + rel])
        check('headers_' + rel.split('/')[-1], h.get_all('Cache-Control') == ['no-store, no-transform'] and h.get_all('X-Frame-Options') == ['DENY'] and (h.get_all('X-Content-Type-Options') == ['nosniff']) and (h.get('Cross-Origin-Opener-Policy') == 'same-origin') and (h.get('Origin-Agent-Cluster') == '?1') and (not h.get('CF-Ray')))
    for rel in ['', slug, 'vault/app.js', 'rpc?x', 'ARTIFACT.json', '%E0']:
        (status, _, _) = request(base + rel, True)
        check('unlisted_or_malformed_path_refused', status in ([400, 404] if rel == '%E0' else [404]))
    check('host_root_refuses', request(origin + '/')[0] == 404)
    rpc = {'jsonrpc': '2.0', 'id': 1, 'method': 'getGenesisHash', 'params': []}
    (status, data, _) = request(base + 'rpc', True, rpc, {'Origin': origin})
    check('mainnet_genesis_read', status == 200 and json.loads(data).get('result') == '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    check('wrong_origin_refused', request(base + 'rpc', True, rpc, {'Origin': 'https://centralbankofbitcoin.com'})[0] == 403)
    rpc['method'] = 'getClusterNodes'
    check('forbidden_read_method_refused', request(base + 'rpc', True, rpc, {'Origin': origin})[0] == 403)
    with activation.delivery_lock(Path('/run/cbob-signing')):
        if not gate.exists():
            raise RuntimeError('Delivery safety check failed')
        activation.atomic(Path('/run/cbob-signing/auth.htpasswd'), original, 416, before.st_gid)
    check('temporary_credential_removed', auth.read_bytes() == original and request(base + slug + '/', True)[0] == 401)
    after = auth.stat()
    check('gary_entry_and_auth_metadata_preserved', (before.st_ino, before.st_uid, before.st_gid, before.st_mode) == (after.st_ino, after.st_uid, after.st_gid, after.st_mode))
    retire_verification_timer()
    run(['systemctl', 'stop', unit])
    stopped('normal_stop_closes_delivery')
    run(['systemctl', 'start', unit])
    wait_for_listener()
    activate()
    check('authentication_required_after_restart', request(base + slug + '/')[0] == 401)
    run(['systemctl', 'kill', '--kill-who=main', '--signal=SIGKILL', unit])
    stopped('forced_process_exit_closes_delivery')
    dropdir = Path('/run/systemd/system') / (unit + '.d')
    drop = dropdir / '99-cbob-verification-start-failure.conf'
    if not not dropdir.exists():
        raise RuntimeError('Delivery safety check failed')
    dropdir.mkdir(mode=493)
    try:
        drop.write_text('[Service]\nExecStartPre=+/usr/bin/touch /run/cbob-signing/open\nExecStartPre=/usr/bin/false\n')
        run(['systemctl', 'daemon-reload'])
        subprocess.run(['systemctl', 'reset-failed', unit], capture_output=True)
        failed = subprocess.run(['systemctl', 'start', unit], capture_output=True, timeout=40)
        check('intentional_start_failure_observed', failed.returncode != 0)
        stopped('startup_failure_closes_delivery')
    finally:
        drop.unlink(missing_ok=True)
        dropdir.rmdir()
        run(['systemctl', 'daemon-reload'])
        subprocess.run(['systemctl', 'reset-failed', unit], capture_output=True)
    with activation.delivery_lock(Path('/run/cbob-signing')):
        gate.touch(mode=420)
        failed = subprocess.run(['systemctl', 'start', 'cbob-signing-refuse.service'], capture_output=True, timeout=15)
        check('contended_lock_fails_closed', failed.returncode != 0 and (not gate.exists()) and (not Path('/run/cbob-signing/auth.htpasswd').exists()))
    subprocess.run(['systemctl', 'reset-failed', 'cbob-signing-refuse.service'], capture_output=True)
    run(['systemctl', 'start', 'cbob-signing-refuse.service'])
    stopped('closure_recovers_after_lock_contention')
    conn = http.client.HTTPConnection('sign.centralbankofbitcoin.com', timeout=10)
    conn.request('GET', '/')
    response = conn.getresponse()
    check('http_redirects_to_dedicated_https', response.status == 301 and response.getheader('Location') == origin + '/')
    response.read()
    conn.close()
    marker = Path('/var/www/cbob-signing-acme/.well-known/acme-challenge') / ('delivery-' + secrets.token_hex(12))
    marker.write_text('CBOB delivery verification')
    marker.chmod(420)
    try:
        (status, data, _) = request('http://sign.centralbankofbitcoin.com/.well-known/acme-challenge/' + marker.name)
        check('acme_webroot_still_works', status == 200 and data == b'CBOB delivery verification')
    finally:
        marker.unlink()
    check('dns_resolves_direct_origin', {x[4][0] for x in socket.getaddrinfo('sign.centralbankofbitcoin.com', 443, type=socket.SOCK_STREAM)} == {'52.70.29.152'})
    legacy = json.loads(Path('/var/backups/cbob-signing/20261012T165032Z/state.json').read_text())['legacy_path']
    check('old_apex_edge_refuses', request('https://centralbankofbitcoin.com' + legacy, headers={'User-Agent': 'curl/8.0.1'})[0] == 410)
    direct = subprocess.run(['curl', '--silent', '--output', '/dev/null', '--write-out', '%{http_code}', '--resolve', 'centralbankofbitcoin.com:443:52.70.29.152', '--max-time', '20', '--config', '-'], input='url = "https://centralbankofbitcoin.com' + legacy + '"\n', capture_output=True, text=True)
    check('old_apex_origin_refuses', direct.returncode == 0 and direct.stdout == '410')
    report['result'] = 'passed'
finally:
    gate.unlink(missing_ok=True)
    subprocess.run(['systemctl', 'stop', unit], capture_output=True)
    subprocess.run(['systemctl', 'start', 'cbob-signing-refuse.service'], capture_output=True)
    retire_verification_timer()
    if not auth.read_bytes() == original:
        raise RuntimeError('Original auth bytes differ')
    Path('/var/backups/cbob-signing/delivery-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
