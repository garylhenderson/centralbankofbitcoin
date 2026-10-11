#!/usr/bin/env bash
# Committed replacement for the retired /tmp go-live script. Never initializes or locks.
set -euo pipefail
cd /opt/cbob-vaults
if [ "${1:-}" != '--execute' ]; then
  echo 'Plan: require a reviewed pushed commit and matching collection; configure the read relay; start it; validate nginx and RPC refusals. No crons, financial switches or on-chain writes.'
  exit 0
fi
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'Commit and review the release before go-live.' >&2; exit 1; }
[ "$(id -un)" = ubuntu ] || { echo 'Run as ubuntu, without sudo.' >&2; exit 1; }
head=$(git rev-parse HEAD)
[ "${2:-}" = "$head" ] || { echo 'Pass --execute and the exact reviewed commit.' >&2; exit 1; }
git merge-base --is-ancestor "$head" origin/v6 || { echo 'Push the reviewed commit first.' >&2; exit 1; }
bash web/deploy/publish-ecosystem.sh --check "$head"
# A relay restart does not reconsider already-fixed charter dates.
collection=$(node --input-type=module - <<'JS'
import fs from 'node:fs'
import { PROFILES } from './web/src/config.js'
import { PublicKey } from '@solana/web3.js'
const recorded=JSON.parse(fs.readFileSync('launch/mainnet-init.json')).vault_collection.value
if(!recorded || recorded!==PROFILES.mainnet.collection || new PublicKey(recorded).toBase58()!==recorded)throw new Error('The committed collection must match both launch and web configuration')
console.log(recorded)
JS
)
exec 8>/opt/cbob-vaults/.cache/go-live.flock
flock -n 8 || { echo 'Another relay release is running.' >&2; exit 1; }
previous=$(pm2 pid cbob-rpc-proxy)
configuration=$(sudo python3 web/deploy/configure-rpc.py "$collection" --execute)
rollback() {
  sudo python3 web/deploy/configure-rpc.py --restore "$configuration"
  if [[ "$previous" =~ ^[1-9][0-9]*$ ]]; then pm2 restart cbob-rpc-proxy; else pm2 delete cbob-rpc-proxy || true; fi
  pm2 save
  sudo nginx -t && sudo systemctl reload nginx
  echo "Relay release failed; configuration restored from $configuration" >&2
}
trap rollback ERR
pm2 startOrRestart web/deploy/ecosystem.rpc-proxy.config.cjs
sleep 2
node web/deploy/check-live-rpc.mjs --direct
sudo nginx -t
sudo systemctl reload nginx
node web/deploy/check-live-rpc.mjs
bash web/deploy/publish-ecosystem.sh --execute "$head"
pm2 save
trap - ERR
printf 'Public relay and pages checked. Financial switches and scheduled jobs were not changed.\n'
