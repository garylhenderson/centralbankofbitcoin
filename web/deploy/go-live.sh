#!/usr/bin/env bash
# Committed replacement for the retired /tmp go-live script. Never initializes or locks.
set -euo pipefail
cd /opt/cbob-vaults
if [ "${1:-}" != '--execute' ]; then
  echo 'Plan: require a reviewed pushed commit and matching collection; configure the read relay; start it; validate nginx and RPC refusals. No crons, financial switches or on-chain writes.'
  exit 0
fi
[ "$(id -un)" = ubuntu ] || { echo 'Run as ubuntu, without sudo.' >&2; exit 1; }
mkdir -p .cache
exec 8>/opt/cbob-vaults/.cache/go-live.flock
flock -n 8 || { echo 'Another relay release is running.' >&2; exit 1; }
head=$(git rev-parse HEAD)
[ "${2:-}" = "$head" ] || { echo 'Pass --execute and the exact reviewed commit.' >&2; exit 1; }
verify_source() {
  [ -z "$(git status --porcelain --untracked-files=all)" ] && [ "$(git rev-parse HEAD)" = "$head" ] || { echo 'Reviewed source changed; stop the release.' >&2; return 1; }
}
# Do not let a daemon started by pm2 inherit the deployment lock.
run_pm2() { command pm2 "$@" 8>&-; }
verify_source
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
previous=$(run_pm2 pid cbob-rpc-proxy)
previous_defined=false
if run_pm2 describe cbob-rpc-proxy >/dev/null 2>&1; then previous_defined=true; fi
verify_source
configuration=$(sudo /usr/bin/python3 -I web/deploy/configure-rpc.py "$collection" --execute)
rollback() {
  trap - ERR
  set +e
  if verify_source; then
    sudo /usr/bin/python3 -I web/deploy/configure-rpc.py --restore "$configuration" || echo 'Configuration restore failed; operator recovery required.' >&2
  else
    echo "Source changed; refusing root restore from the working tree. Restore backup $configuration using configure-rpc.py from reviewed commit $head after restoring and verifying the reviewed source." >&2
  fi
  if [[ "$previous" =~ ^[1-9][0-9]*$ ]]; then
    run_pm2 restart cbob-rpc-proxy || echo 'Relay restart failed.' >&2
  elif $previous_defined; then
    run_pm2 stop cbob-rpc-proxy || echo 'Restoring stopped relay state failed.' >&2
  else
    run_pm2 delete cbob-rpc-proxy || echo 'Removing new relay failed.' >&2
  fi
  run_pm2 save || echo 'Saving restored process state failed.' >&2
  if sudo nginx -t; then sudo systemctl reload nginx || echo 'nginx reload failed.' >&2; else echo 'Restored nginx configuration failed validation.' >&2; fi
  echo "Relay release failed; configuration recovery attempted from $configuration. Published pages and source code were not rolled back." >&2
  exit 1
}
trap rollback ERR
verify_source
run_pm2 startOrRestart web/deploy/ecosystem.rpc-proxy.config.cjs
sleep 2
node web/deploy/check-live-rpc.mjs --direct
sudo nginx -t
sudo systemctl reload nginx
node web/deploy/check-live-rpc.mjs
run_pm2 save
# From this point publishing is independently guarded; do not roll a healthy
# relay back underneath pages that may already have been published.
trap - ERR
verify_source
bash web/deploy/publish-ecosystem.sh --execute "$head"
printf 'Public relay and pages checked. Financial switches and scheduled jobs were not changed.\n'
