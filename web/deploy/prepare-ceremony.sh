#!/usr/bin/env bash
# Build an isolated candidate; install only a separately committed reviewed attestation.
set -euo pipefail
cd /opt/cbob-vaults
[[ ( "${1:-}" = --build || "${1:-}" = --install ) && "${2:-}" =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage: prepare-ceremony.sh --build|--install <source-commit>'; exit 2; }
commit=$2
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'Commit reviewed source first.' >&2; exit 1; }
git fetch -q origin v6
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/v6)" ] || { echo 'Use the pushed reviewed tip.' >&2; exit 1; }
git merge-base --is-ancestor "$commit" HEAD
candidate="/opt/cbob-vaults/.cache/ceremony-artifacts/$commit"
if [ "$1" = --install ]; then
  [[ "${3:-}" =~ ^[a-f0-9]{40}$ && "${4:-}" =~ ^[a-f0-9]{64}$ ]] || { echo 'Install also requires the independently reviewed attestation commit and digest.' >&2; exit 1; }
  sudo -n /usr/local/sbin/cbob-install-ceremony "$candidate" "$3" "$commit" "$4"
  exit
fi
[ "$(git rev-parse HEAD)" = "$commit" ] || { echo 'Build the exact source tip.' >&2; exit 1; }
[ ! -e "$candidate" ] || { echo 'Candidate exists; retain it and use a new reviewed commit.' >&2; exit 1; }
mkdir -p .cache/ceremony-artifacts
stage=$(mktemp -d /tmp/cbob-ceremony-source.XXXXXXXX)
cleanup(){ git worktree remove --force "$stage/tree" >/dev/null 2>&1 || true; rm -rf "$stage"; }
trap cleanup EXIT
git worktree add --detach "$stage/tree" "$commit" >/dev/null
# node_modules is a tracked build-time symlink in this repository. It is never
# copied into the artifact. Do not run ln against it (its target is a directory).
[ "$(readlink "$stage/tree/node_modules")" = /opt/gary-club/node_modules ] || { echo 'Unexpected build dependency link.' >&2; exit 1; }
cp -a /opt/cbob-vaults/dist "$stage/tree/dist"
node "$stage/tree/scripts/update-web-hashes.mjs" > "$stage/pins.log"
out="$stage/artifact"
mkdir -p "$out/web/deploy"
node "$stage/tree/web/build.mjs" --profile mainnet-local --dist "$stage/tree/dist" --out "$out/web/dist-mainnet-local" > "$stage/build.log"
[ -z "$(git -C "$stage/tree" status --porcelain --untracked-files=all)" ] || { echo 'Isolated build changed source.' >&2; exit 1; }
cp "$stage/tree/web/README.md" "$out/web/README.md"
cp "$stage/tree/web/deploy/ceremony-build.mjs" "$stage/tree/web/deploy/launch-ceremony.mjs" "$stage/tree/web/deploy/check-ceremony-env.py" "$out/web/deploy/"
node "$stage/tree/web/deploy/bundle-ceremony.mjs" "$stage/tree" "$out"
node --input-type=module - "$out" "$commit" "$stage/tree" <<'JS'
import fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto'
const root=process.argv[2],files={};
const readme=fs.readFileSync(path.join(root,'web/README.md'),'utf8'),review=readme.match(/^Pin review: `([^`]+)` · sha256 `([a-f0-9]{64})`/m)
if(!review||review[1].includes('..')||path.isAbsolute(review[1]))throw Error('Missing safe review record')
// Read the review from the isolated source that supplied the pin table.
const reviewBytes=fs.readFileSync(path.join(process.argv[4],review[1]))
if(createHash('sha256').update(reviewBytes).digest('hex')!==review[2])throw Error('Pin review hash differs')
fs.writeFileSync(path.join(root,'web/deploy/pin-review.md'),reviewBytes)
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('No symlinks');if(e.isDirectory())walk(f);else files[path.relative(root,f)]=createHash('sha256').update(fs.readFileSync(f)).digest('hex')}}walk(root)
const record={source_commit:process.argv[3],files};fs.writeFileSync(path.join(root,'ARTIFACT.json'),JSON.stringify(record,null,2)+'\n')
console.log('Candidate built from isolated source. Review ARTIFACT.json, then commit its exact bytes as launch/ceremony-artifact.json before --install.')
JS
mv "$out" "$candidate"
