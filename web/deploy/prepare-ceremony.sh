#!/usr/bin/env bash
# Builds and stages a reviewed hosted artifact; never changes DNS or starts signing.
set -euo pipefail
cd /opt/cbob-vaults
[[ "${1:-}" =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage: prepare-ceremony.sh <reviewed-commit>'; exit 2; }
commit=$1
[ "$(git rev-parse HEAD)" = "$commit" ] && [ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'Use clean reviewed HEAD.' >&2; exit 1; }
git merge-base --is-ancestor "$commit" origin/v6
node scripts/update-web-hashes.mjs
stage=$(mktemp -d /tmp/cbob-ceremony.XXXXXXXX)
trap 'rm -rf "$stage"' EXIT
git archive "$commit" web/deploy web/src/config.js web/README.md | tar -x -C "$stage"
node web/build.mjs --profile mainnet-local --out "$stage/web/dist-mainnet-local" > "$stage/build.log"
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'Build changed source; refused.' >&2; exit 1; }
node --input-type=module - "$stage" "$commit" <<'JS'
import {verifyCeremonyBuild} from './web/deploy/ceremony-build.mjs'
verifyCeremonyBuild(process.argv[2]+'/web/dist-mainnet-local',process.argv[3],{requireRootOwned:false})
JS
target="/opt/cbob-ceremony/$commit"
sudo install -d -o root -g root -m 755 /opt/cbob-ceremony
if [ -e "$target" ]; then echo 'Artifact already exists; verify it rather than overwriting it.' >&2; exit 1; fi
sudo mkdir "$target"
sudo cp -a "$stage/web" "$target/"
sudo chown -R root:root "$target"
sudo chmod -R go-w "$target"
sudo ln -s /opt/gary-club/node_modules "$target/node_modules"
node --input-type=module - "$target" "$commit" <<'JS'
import {verifyCeremonyBuild} from './web/deploy/ceremony-build.mjs'
console.log(verifyCeremonyBuild(process.argv[2]+'/web/dist-mainnet-local',process.argv[3]))
JS
echo 'Artifact prepared. No service, DNS, action switch or on-chain state changed.'
