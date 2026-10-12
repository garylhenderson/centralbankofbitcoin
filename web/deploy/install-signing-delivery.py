"""One-time installation from an explicit pushed/reviewed git object. No start."""
from pathlib import Path
import os, sys, re, subprocess, json, hashlib, secrets, pwd
os.umask(63)
if not (os.geteuid() == 0 and len(sys.argv) == 2 and re.fullmatch('[a-f0-9]{40}', sys.argv[1])):
    raise RuntimeError('Delivery safety check failed')
review = sys.argv[1]
repo = '/opt/cbob-vaults'
commit = 'a9dcaca08e6db389a24333009d7008ba8c9d235d'
digest = 'd1b17742d19a1082f89f0d6bb105e69ac5a6a3da575602d6e62b883da5b94b9f'
EXPECTED = {'web/deploy/signing-refuse.py': '125f75a36684a4625e6433c6c407624f60900f06a67556da3162cae85ea95cdc', 'web/deploy/signing-activate.py': '7392304a714af426bbd9b48ed59a6497397e32cd7a14e5f78df8f7347060623a', 'web/deploy/nginx-signing-active.conf': '59055bd3401cbe79be8613bddb0aa1987eab6aa617262792c98b4b989cf045f7', 'web/deploy/nginx-signing-refusal.conf': 'c62369939dc6d34a76e08d7216020e4893deae2df79ffe7e24b02b0e543bb4c2', 'web/deploy/cbob-signing-refuse.service': '5e212915a9660c89433920ac5e78767fe4ce7d3d3d16a99225264d63def9a960', 'web/deploy/cbob-ceremony@.service': 'ed659ff3ddf6bc06be71437bd371d12cc2cf8b15431fc3b09fd5316112514000', 'web/deploy/nginx-signing-location.conf.example': 'ce0d3871e721ac5580914ed6abdf34dd0d19b121329ec77912af9cc23db4c32d'}

def git(rel):
    b = subprocess.check_output(['git', '-C', repo, 'show', review + ':' + rel])
    if rel not in EXPECTED or hashlib.sha256(b).hexdigest() != EXPECTED[rel]:
        raise RuntimeError('Delivery source differs from reviewed fingerprints')
    return b
if subprocess.run(['git', '-C', repo, 'merge-base', '--is-ancestor', review, 'origin/v6'], capture_output=True).returncode:
    raise RuntimeError('Delivery source is not on the pushed branch')
for rel in EXPECTED:
    git(rel)

def atomic(path, data, mode=420):
    p = Path(path)
    t = p.with_name('.' + p.name + '.cbob-new')
    if not not t.exists():
        raise RuntimeError('Delivery safety check failed')
    fd = os.open(t, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as out:
        os.fchown(out.fileno(), 0, 0)
        out.write(data)
        out.flush()
        os.fsync(out.fileno())
    os.chmod(t, mode)
    os.replace(t, p)

def values(p):
    out = {}
    for l in p.read_text().splitlines():
        if not l.strip() or l.lstrip().startswith('#'):
            continue
        m = re.fullmatch('([A-Z_][A-Z_0-9]*)=(.*)', l)
        if not (m and m[1] not in out):
            raise RuntimeError('Delivery safety check failed')
        out[m[1]] = m[2].strip().strip('"\'')
    return out
identity = values(Path('/etc/cbob/ceremony-' + commit + '.env'))
if not identity == {'CBOB_CEREMONY_ARTIFACT_SHA256': digest}:
    raise RuntimeError('Delivery safety check failed')
rpc = Path('/etc/cbob/rpc-proxy.env')
if not set(values(rpc)) == {'CBOB_RPC_UPSTREAM', 'CBOB_RPC_ORIGIN', 'CBOB_RPC_PORT'}:
    raise RuntimeError('Delivery safety check failed')
if not not Path('/etc/systemd/system/cbob-ceremony@.service').exists():
    raise RuntimeError('Delivery safety check failed')
if not Path('/etc/nginx/sites-available/cbob-signing').read_bytes() == git('web/deploy/nginx-signing-refusal.conf'):
    raise RuntimeError('Delivery safety check failed')
secret = secrets.token_hex(32)
outer = 'initialize-' + secrets.token_hex(24)
if not not Path('/etc/nginx/cbob-signing-proxy-secret.conf').exists():
    raise RuntimeError('Delivery safety check failed')
atomic('/etc/nginx/cbob-signing-proxy-secret.conf', ('proxy_set_header X-CBOB-Ceremony ' + secret + ';\n').encode(), 384)
atomic('/etc/nginx/cbob-signing-location.conf', git('web/deploy/nginx-signing-location.conf.example').replace(b'CEREMONY-PATH', outer.encode()), 384)
ceremony = {'CBOB_CEREMONY_PROFILE': 'mainnet-hosted', 'CBOB_CEREMONY_ORIGINS': 'https://sign.centralbankofbitcoin.com', 'CBOB_CEREMONY_HOSTED_AUTH': 'nginx-basic', 'CBOB_CEREMONY_PROXY_SECRET': secret}
atomic('/etc/cbob/ceremony.env', ''.join((k + '=' + v + '\n' for (k, v) in ceremony.items())).encode(), 384)
os.chown(rpc, 0, pwd.getpwnam('ubuntu').pw_gid)
os.chmod(rpc, 416)
rows = []
files = [('signing-refuse.py', '/usr/local/libexec/cbob-signing-refuse.py', 493), ('signing-activate.py', '/usr/local/libexec/cbob-signing-activate.py', 493), ('nginx-signing-active.conf', '/etc/nginx/cbob-signing-active.conf', 420), ('nginx-signing-refusal.conf', '/etc/nginx/cbob-signing-refusal.conf', 420), ('cbob-signing-refuse.service', '/etc/systemd/system/cbob-signing-refuse.service', 420), ('cbob-ceremony@.service', '/etc/systemd/system/cbob-ceremony@.service', 420)]
Path('/usr/local/libexec').mkdir(mode=493, exist_ok=True)
for (source, destination, mode) in files:
    b = git('web/deploy/' + source)
    atomic(destination, b, mode)
    rows.append({'source': source, 'destination': destination, 'sha256': hashlib.sha256(b).hexdigest()})
for command in [['/usr/bin/python3', '-I', '/opt/cbob-ceremony/' + commit + '/web/deploy/check-ceremony-env.py', commit], ['/usr/bin/systemd-analyze', 'verify', '/etc/systemd/system/cbob-ceremony@.service', '/etc/systemd/system/cbob-signing-refuse.service'], ['/usr/bin/systemctl', 'daemon-reload']]:
    r = subprocess.run(command, capture_output=True)
    if not r.returncode == 0:
        raise RuntimeError('Install validation failed: ' + command[0])
rows.append({'source': 'rendered-location', 'destination': '/etc/nginx/cbob-signing-location.conf', 'sha256': hashlib.sha256(Path('/etc/nginx/cbob-signing-location.conf').read_bytes()).hexdigest()})
state = {'source_commit': commit, 'delivery_commit': review, 'outer_path': outer, 'files': rows, 'artifact_sha256': digest}
atomic('/etc/cbob/signing-delivery-state.json', (json.dumps(state, indent=2) + '\n').encode(), 384)
print(json.dumps({'installed_no_start': True, 'delivery_commit': review, 'identity_digest_matches_owner': True, 'files': rows}, indent=2))
