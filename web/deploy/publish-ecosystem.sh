#!/usr/bin/env bash
# Publish a reviewed commit. No initialization, financial switches or on-chain writes.
set -euo pipefail
cd /opt/cbob-vaults
[[ "${1:-}" = '--execute' || "${1:-}" = '--check' ]] || { echo 'Dry: --execute <reviewed-commit> builds pinned profiles, backs up every touched file and publishes without deletion.'; exit 0; }
[ "$(id -un)" = ubuntu ] || { echo 'Run as ubuntu, without sudo.' >&2; exit 1; }
exec 9>/opt/cbob-vaults/.cache/publish.flock
flock -n 9 || { echo 'Another Bank publication is in progress.' >&2; exit 1; }
head=$(git rev-parse HEAD)
[ "${2:-}" = "$head" ] || { echo 'Pass the exact reviewed commit.' >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'Commit reviewed changes before publishing.' >&2; exit 1; }
git merge-base --is-ancestor "$head" origin/v6 || { echo 'Push the reviewed commit before publishing.' >&2; exit 1; }
[ -z "$(git status --ignored --porcelain -- web/src web/site)" ] || { echo 'Unreviewed or ignored source files found.' >&2; exit 1; }
node scripts/prepare-static-pages.mjs
stage=$(mktemp -d /tmp/cbob-publish.XXXXXXXX)
trap 'rm -rf "$stage"' EXIT
node scripts/update-web-hashes.mjs > "$stage/pins.log"
node web/build.mjs --out "$stage/dist" > "$stage/build.log"
recorded=$(sed -n 's/^commit    //p' "$stage/dist/BUILD.txt")
[ "$recorded" = "$head" ] || { echo 'Build record is not the reviewed commit.' >&2; exit 1; }
[ "${1:-}" != '--check' ] || { echo 'Reviewed commit, pins and build checked.'; exit 0; }
git archive HEAD web/site | tar -x -C "$stage"
mkdir "$stage/public"
cp -a "$stage/web/site/." "$stage/public/"
for section in assets account vault redeem claim buy market governance history; do
  mkdir -p "$stage/public/$section"
  cp -a "$stage/dist/$section/." "$stage/public/$section/"
done
# The build manifest must cover every staged build file; pins cover executable bundles.
node --input-type=module - "$stage" <<'JS'
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto'
const stage=process.argv[2], dist=path.join(stage,'dist'), root=path.join(stage,'public')
const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const manifest=new Map(fs.readFileSync(path.join(dist,'BUILD.txt'),'utf8').split('\n').flatMap(l=>{const m=/^([a-f0-9]{64})  (.+)$/.exec(l);return m?[[m[2],m[1]]]:[]}))
const pins=new Map([...fs.readFileSync('web/README.md','utf8').matchAll(/^\| `mainnet` \| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)].map(m=>[m[1],m[2]]))
for(const [f,h] of manifest){if(f.startsWith('ceremony-'))continue;const target=path.join(root,f);if(!fs.existsSync(target)||sha(target)!==h)throw new Error('Staged bytes differ: '+f);if((f.endsWith('/app.js')||f==='assets/style.css')&&pins.get(f)!==h)throw new Error('Staged pin differs: '+f)}
for(const [f] of manifest){if(f.startsWith('ceremony-'))continue;const staticFile=path.join(stage,'web/site',f);if(fs.existsSync(staticFile))throw new Error('Static/build collision: '+f)}
JS
bash web/deploy/pin-public-data.sh --prepare "$head"
# The static tree owns bank-home.js and ecosystem-nav.css; both survive the merged build.
backup="/var/backups/cbob-ecosystem/$(date -u +%Y%m%dT%H%M%S)-$(basename "$stage")"
sudo mkdir -p /var/backups/cbob-ecosystem
printf 'Restore point: %s\n' "$backup"
sudo python3 web/deploy/publish-files.py "$stage/public" /var/www/centralbankofbitcoin "$backup"
sudo install -d -o ubuntu -g www-data -m 755 /var/www/centralbankofbitcoin/data /var/www/centralbankofbitcoin/v
if ! bash web/deploy/pin-public-data.sh --execute "$head"; then
  echo 'Public-data activation failed; attempting to restore the previous pages. See activation output for timer recovery status.' >&2
  if ! sudo python3 web/deploy/publish-files.py --restore "$backup"; then
    echo "RESTORE FAILED: manual page recovery required from $backup. Check the timer override separately." >&2
    exit 1
  fi
  echo 'Previous pages restored.' >&2
  exit 1
fi
