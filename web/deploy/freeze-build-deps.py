#!/usr/bin/env python3
"""Reconstruct isolated build dependencies from locked registry tarballs.
No npm invocation, lifecycle scripts, live app changes or credentials.
"""
import argparse, base64, hashlib, io, json, os, pathlib, re, shutil, tarfile, tempfile
import urllib.parse, urllib.request

MAX_ARCHIVE = 40 * 1024 * 1024
MAX_PACKAGE = 160 * 1024 * 1024

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Registry redirects are refused')

def canonical(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()

def safe_path(value):
    if not isinstance(value, str) or not value or '\\' in value or value.startswith('/'):
        raise ValueError('Unsafe dependency path')
    parts = value.split('/')
    if any(x in ('', '.', '..') for x in parts):
        raise ValueError('Unsafe dependency path')
    return pathlib.PurePosixPath(value)

def fetch_tarball(entry):
    url = urllib.parse.urlsplit(entry['resolved'])
    if url.scheme != 'https' or url.netloc != 'registry.npmjs.org' or url.query or url.fragment:
        raise ValueError('Only canonical npm registry tarballs are accepted')
    integrity = entry['integrity']
    if not re.fullmatch(r'sha512-[A-Za-z0-9+/]+={0,2}', integrity):
        raise ValueError('A single locked sha512 registry integrity is required')
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(entry['resolved'], timeout=30) as response:
        data = response.read(MAX_ARCHIVE + 1)
    if len(data) > MAX_ARCHIVE:
        raise ValueError('Dependency archive exceeds size limit')
    want = base64.b64decode(integrity[7:], validate=True)
    if len(want) != 64 or hashlib.sha512(data).digest() != want:
        raise ValueError('Registry tarball integrity differs')
    return data

def extract_package(data, destination):
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = archive.getmembers()
        if sum(m.size for m in members) > MAX_PACKAGE or len(members) > 20000:
            raise ValueError('Expanded package exceeds size limit')
        seen = set()
        for member in members:
            # Directory entries sometimes end in slash. Everything else is
            # validated literally; links and devices are never extracted.
            rel = safe_path(member.name.rstrip('/') if member.isdir() else member.name)
            if rel.parts[0] != 'package' or 'node_modules' in rel.parts:
                raise ValueError('Unexpected tarball layout')
            if not member.isfile() and not member.isdir():
                raise ValueError('Package links and special files are refused')
            if len(rel.parts) == 1:
                if not member.isdir():
                    raise ValueError('Invalid package root')
                continue
            key = '/'.join(rel.parts[1:])
            if key in seen:
                raise ValueError('Duplicate package entry')
            seen.add(key)
            target = destination.joinpath(*rel.parts[1:])
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as out, archive.extractfile(member) as source:
                    shutil.copyfileobj(source, out)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)

def freeze(records, output):
    packages, inputs = {}, {}
    node = records[0]['node']
    esbuild = records[0]['esbuild']
    for record in records:
        if record.get('schema') != 1 or record['node'] != node or record['esbuild'] != esbuild:
            raise ValueError('Discovery toolchain differs')
        for key, entry in record['packages'].items():
            rel = safe_path(key)
            if len(rel.parts) < 3 or rel.parts[0] not in ('app', 'tools') or rel.parts[1] != 'node_modules':
                raise ValueError('Invalid package location')
            if key in packages and packages[key] != entry:
                raise ValueError('Conflicting package identities')
            packages[key] = entry
        for key, digest in record['inputs'].items():
            if key.startswith('source/'):
                continue
            safe_path(key)
            if not re.fullmatch('[0-9a-f]{64}', digest):
                raise ValueError('Invalid input hash')
            if key in inputs and inputs[key] != digest:
                raise ValueError('Dependency changed between discoveries')
            inputs[key] = digest
    output = pathlib.Path(output).absolute()
    if output.exists():
        raise ValueError('Snapshot output already exists; retain it')
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = pathlib.Path(tempfile.mkdtemp(prefix='.deps-', dir=output.parent))
    try:
        cache = {}
        for key, entry in sorted(packages.items(), key=lambda pair: (len(pair[0]), pair[0])):
            integrity = entry['integrity']
            if integrity not in cache:
                cache[integrity] = fetch_tarball(entry)
            destination = stage / key
            extract_package(cache[integrity], destination)
            pkg = json.loads((destination / 'package.json').read_text())
            if pkg.get('name') != entry['name'] or pkg.get('version') != entry['version']:
                raise ValueError('Registry package identity differs')
        for key, digest in inputs.items():
            if not (stage / key).is_file() or hashlib.sha256((stage / key).read_bytes()).hexdigest() != digest:
                raise ValueError('Installed input differs from registry package: ' + key)
        files = {str(f.relative_to(stage)): hashlib.sha256(f.read_bytes()).hexdigest()
                 for f in sorted(stage.rglob('*')) if f.is_file()}
        manifest = canonical({'schema': 1, 'node': node, 'esbuild': esbuild, 'packages': packages, 'files': files})
        digest = hashlib.sha256(manifest).hexdigest()
        for record in records:
            if record.get('snapshot_sha256') and record['snapshot_sha256'] != digest:
                raise ValueError('Reconstructed snapshot differs from committed pin')
        (stage / 'DEPENDENCIES.json').write_bytes(manifest)
        # Ordinary builds may read but not accidentally overwrite dependencies.
        for f in stage.rglob('*'):
            f.chmod(0o555 if f.is_dir() or f.stat().st_mode & 0o111 else 0o444)
        stage.chmod(0o555)
        stage.rename(output)
        return hashlib.sha256(manifest).hexdigest()
    finally:
        if stage.exists():
            for f in stage.rglob('*'):
                if f.is_dir(): f.chmod(0o755)
            stage.chmod(0o755)
            shutil.rmtree(stage)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    parser.add_argument('records', nargs='+')
    args = parser.parse_args()
    try:
        digest = freeze([json.loads(pathlib.Path(p).read_text()) for p in args.records], args.out)
        print('DEPENDENCIES.json sha256 ' + digest)
    except Exception as error:
        # Do not echo arbitrary HTTP errors or URLs from dependencies.
        print('Dependency freeze refused: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__))
        raise SystemExit(1)
